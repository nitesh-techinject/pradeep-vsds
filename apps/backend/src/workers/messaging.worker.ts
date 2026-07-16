/**
 * Messaging Worker — processes individual WHATSAPP_MESSAGES and EMAIL_MESSAGES jobs.
 *
 * WhatsApp: used for DLQ retries only. Initial sends go via WatiService.sendWhatsAppBulk.
 * Email: processes all email sends (Resend has no bulk API).
 *
 * Rate limiting: 1 msg/sec sleep for WhatsApp retries, BullMQ limiter for emails.
 * Retries: BullMQ handles automatic retries with exponential backoff.
 */
import { createWorker, addJob, QUEUES } from '@/queue';
import { formatName } from '@/utils/formatName';
import type { WhatsAppMessageJob, EmailMessageJob } from '@/queue/types';
import type { Job } from 'bullmq';
import { config } from '@/config';
import { db } from '@/db';
import { commLog, failedMessages, messageSendLog, batches, watiTemplates, type BatchStats } from '@/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { resolveParams } from '@/services/TemplateEngine';
import { BatchService } from '@/services/BatchService';
import { getCachedTemplate, normalizeIndianPhone, clearTemplateCache } from '@/services/WatiService';
import { logApiCall } from '@/services/ApiCallLogger';

export { clearTemplateCache };

// ─── WATI single-message send (used for DLQ retries) ─────────────────────────

async function sendWhatsApp(job: WhatsAppMessageJob): Promise<string> {
  if (config.disableMessaging) {
    console.log(`[messaging] DISABLE_MESSAGING=true — skipping WhatsApp to ${job.phone}`);
    return 'disabled';
  }
  if (!config.wati.baseUrl || !config.wati.apiKey) {
    throw new Error('WATI not configured');
  }

  const bookCount = job.books?.length ?? 0;
  const tmpl = await getCachedTemplate(bookCount) as typeof watiTemplates.$inferSelect | undefined;
  console.log(`[messaging] batch=${job.batchId} teacher=${job.name} books=${bookCount} template=${tmpl?.templateName ?? 'legacy'}`);

  let templateName: string;
  let parameters: { name: string; value: string }[];

  const parsedParams = typeof tmpl?.params === 'string' ? JSON.parse(tmpl.params) : (tmpl?.params ?? []);
  if (tmpl && parsedParams.length > 0) {
    templateName = tmpl.templateName;
    parameters = resolveParams(tmpl.params, {
      teacherName: job.name,
      teacherPhone: job.phone,
      teacherEmail: job.email,
      school: job.school,
      city: job.city,
      batchId: job.batchId,
      books: job.books ?? [],
    });
  } else {
    templateName = config.wati.templateName || 'specimen_dispatch';
    parameters = [
      { name: 'name', value: job.name },
      { name: 'specimen_details', value: job.specimenDetails },
    ];
  }

  const normalizedPhone = normalizeIndianPhone(job.phone);
  const url = `${config.wati.baseUrl}/api/v1/sendTemplateMessage?whatsappNumber=${normalizedPhone}`;
  const requestBody = { template_name: templateName, broadcast_name: job.batchId, parameters };
  const t0 = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.wati.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    await logApiCall({
      service: 'wati',
      endpoint: `/api/v1/sendTemplateMessage`,
      requestBody,
      responseBody: { raw: text },
      statusCode: response.status,
      errorMessage: `HTTP ${response.status}: ${text.slice(0, 200)}`,
      latencyMs: Date.now() - t0,
      batchId: job.batchId,
      commLogId: job.commLogId,
      teacherPhone: job.phone,
      teacherName: job.name,
    });
    throw new Error(`WATI API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { result?: boolean; local_message_id?: string; id?: string; info?: string };
  if (data.result === false) {
    await logApiCall({
      service: 'wati',
      endpoint: `/api/v1/sendTemplateMessage`,
      requestBody,
      responseBody: data,
      statusCode: 200,
      errorMessage: `WATI rejected: ${data.info ?? 'unknown'}`,
      latencyMs: Date.now() - t0,
      batchId: job.batchId,
      commLogId: job.commLogId,
      teacherPhone: job.phone,
      teacherName: job.name,
    });
    throw new Error(`WATI rejected message: ${data.info ?? 'unknown error'}`);
  }

  await logApiCall({
    service: 'wati',
    endpoint: `/api/v1/sendTemplateMessage`,
    requestBody,
    responseBody: data,
    statusCode: 200,
    latencyMs: Date.now() - t0,
    batchId: job.batchId,
    commLogId: job.commLogId,
    teacherPhone: job.phone,
    teacherName: job.name,
  });
  return data.local_message_id ?? data.id ?? 'unknown';
}

// ─── Resend ───────────────────────────────────────────────────────────────────

async function sendEmail(job: EmailMessageJob): Promise<string> {
  if (config.disableMessaging) {
    console.log(`[messaging] DISABLE_MESSAGING=true — skipping email to ${job.email}`);
    return 'disabled';
  }
  if (!config.resend.apiKey) throw new Error('Resend not configured');

  const { Resend } = await import('resend');
  const resend = new Resend(config.resend.apiKey);

  const loginLink = job.specimenDetails;
  const books = job.books ?? [];
  const bookListHtml = books.length > 0
    ? books.map((b) => `<li><strong>${b.title}</strong> by ${formatName(b.author) || 'Pradeep Publications'}</li>`).join('\n')
    : '';

  const { data, error } = await resend.emails.send({
    from: `${config.resend.fromName} <${config.resend.fromEmail}>`,
    to: job.email,
    subject: `Digital Specimen Books from Pradeep Publications`,
    html: `
      <p>Dear ${job.name},</p>
      <p>We highly value your trust in Pradeep's Books over the years.</p>
      <p>In our endeavour to equip you with our resource material in a better and instant manner, we have now brought for you the digital versions of our following books for your kind review and recommendation:</p>
      ${bookListHtml ? `<ol style="padding-left:20px;">${bookListHtml}</ol>` : ''}
      <p>The access link for the digital copies is shared below for your convenience:</p>
      <p><a href="${loginLink}">${loginLink}</a></p>
      <p>Appreciating your unwavering patronage and assuring you of our constant and consistent efforts to bring you standard academic books from time to time.</p>
      <p>Pradeep Jain<br/>Chairman</p>
    `,
  });

  if (error) throw new Error(error.message);
  return data?.id ?? 'unknown';
}

// ─── Atomic batch completion check ───────────────────────────────────────────

async function incrementAndCheckComplete(batchId: string) {
  try {
    const [updated] = await db
      .update(batches)
      .set({
        stats: sql`jsonb_set(
          COALESCE(stats, '{}'::jsonb),
          '{messagesProcessed}',
          to_jsonb(COALESCE((stats->>'messagesProcessed')::int, 0) + 1)
        )`,
        updatedAt: new Date(),
      })
      .where(eq(batches.id, batchId))
      .returning();

    const stats = updated?.stats as BatchStats | undefined;
    const processed = stats?.messagesProcessed ?? 0;
    const queued = stats?.messagesQueued ?? 0;

    if (queued > 0 && processed >= queued && updated?.status === 'MESSAGING') {
      try {
        await BatchService.advance(batchId, 'auto_messaging_complete');
        console.log(`[messaging] batch=${batchId} all ${queued} messages processed → COMPLETE`);
      } catch {
        // Another worker already advanced
      }
    }
  } catch (err) {
    console.log(`[messaging] batch=${batchId} completion check:`, (err as Error).message);
  }
}

// ─── Shared message processor ────────────────────────────────────────────────

async function processMessage(job: Job<WhatsAppMessageJob | EmailMessageJob>) {
  const { commLogId, batchId } = job.data;

  const log = await db.query.commLog.findFirst({ where: eq(commLog.id, commLogId) });
  if (log?.status === 'CANCELLED') {
    console.log(`[messaging] batch=${batchId} commLog=${commLogId} — cancelled, skipping`);
    await incrementAndCheckComplete(batchId);
    return;
  }

  let externalId: string;
  if (job.data.type === 'WHATSAPP') {
    externalId = await sendWhatsApp(job.data as WhatsAppMessageJob);
  } else {
    externalId = await sendEmail(job.data as EmailMessageJob);
  }

  await db
    .update(commLog)
    .set({
      status: 'SENT',
      externalMessageId: externalId,
      attemptCount: (job.attemptsMade || 0) + 1,
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(commLog.id, commLogId));

  await db.insert(messageSendLog).values({
    id: nanoid(),
    commLogId,
    batchId,
    channel: job.data.type,
    attemptNumber: (job.attemptsMade || 0) + 1,
    status: 'sent',
    externalMessageId: externalId,
    teacherPhone: job.data.type === 'WHATSAPP' ? (job.data as WhatsAppMessageJob).phone : undefined,
    teacherEmail: job.data.type === 'EMAIL' ? (job.data as EmailMessageJob).email : undefined,
    teacherName: job.data.name,
  });

  // Delete the DLQ entry — it's resolved and should exit the failed messages list
  await db
    .delete(failedMessages)
    .where(and(
      eq(failedMessages.commLogId, commLogId),
      inArray(failedMessages.status, ['RETRYING', 'FAILED'])
    ));

  await incrementAndCheckComplete(batchId);
}

// ─── BullMQ Workers ──────────────────────────────────────────────────────────

// WhatsApp worker — handles DLQ retries only (initial sends go via bulk)
const waWorker = createWorker<WhatsAppMessageJob>(
  QUEUES.WHATSAPP_MESSAGES,
  async (job) => {
    await processMessage(job as Job<WhatsAppMessageJob | EmailMessageJob>);
    // WATI rate limit: 1 msg/sec
    await new Promise((r) => setTimeout(r, 1000));
  },
  { concurrency: 1 }
);

// Email worker — 1 msg/sec via BullMQ limiter (Resend rate limit)
const emailWorker = createWorker<EmailMessageJob>(
  QUEUES.EMAIL_MESSAGES,
  async (job) => {
    await processMessage(job as Job<WhatsAppMessageJob | EmailMessageJob>);
  },
  {
    concurrency: 1,
    limiter: { max: 1, duration: 1000 },
  }
);

// Handle max retries exhausted — move to DLQ
for (const worker of [waWorker, emailWorker]) {
  worker.on('failed', async (job, err) => {
    if (!job) return;
    const data = job.data as WhatsAppMessageJob | EmailMessageJob;
    const maxAttempts = job.opts?.attempts ?? 3;

    if (job.attemptsMade >= maxAttempts) {
      const errorMessage = err.message;
      try {
        const existing = await db.query.failedMessages.findFirst({
          where: and(eq(failedMessages.commLogId, data.commLogId), eq(failedMessages.status, 'RETRYING')),
        });

        if (existing) {
          await db
            .update(failedMessages)
            .set({
              errorMessage,
              errorType: errorMessage.includes('RATE') ? 'RATE_LIMIT' : 'UNKNOWN',
              attemptCount: job.attemptsMade,
              status: 'FAILED',
              updatedAt: new Date(),
            })
            .where(eq(failedMessages.id, existing.id));
        } else {
          await db.insert(failedMessages).values({
            id: nanoid(),
            commLogId: data.commLogId,
            batchId: data.batchId,
            channel: data.type,
            teacherPhone: data.type === 'WHATSAPP' ? (data as WhatsAppMessageJob).phone : undefined,
            teacherEmail: data.type === 'EMAIL' ? (data as EmailMessageJob).email : undefined,
            errorType: errorMessage.includes('RATE') ? 'RATE_LIMIT' : 'UNKNOWN',
            errorMessage,
            attemptCount: job.attemptsMade,
            isRetryable: true,
            status: 'FAILED',
          });
        }

        await db
          .update(commLog)
          .set({ status: 'DLQ', lastError: errorMessage, updatedAt: new Date() })
          .where(eq(commLog.id, data.commLogId));

        console.log(`[messaging] batch=${data.batchId} commLog=${data.commLogId} → DLQ after ${job.attemptsMade} attempts`);

        await incrementAndCheckComplete(data.batchId);
      } catch (dlqErr) {
        console.error(`[messaging] DLQ insert failed:`, (dlqErr as Error).message);
      }
    } else {
      await db
        .update(commLog)
        .set({ lastError: err.message, attemptCount: job.attemptsMade, lastAttemptAt: new Date(), updatedAt: new Date() })
        .where(eq(commLog.id, data.commLogId));
    }
  });
}

console.log('[messaging-worker] Ready (WhatsApp retries: 1/sec, Email: 1/sec via limiter)');
