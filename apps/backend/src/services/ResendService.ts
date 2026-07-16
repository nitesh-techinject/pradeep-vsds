/**
 * ResendService — bulk email sending via Resend batch API.
 * Sends in chunks of 100 (Resend batch limit).
 */
import { config } from '@/config';
import { formatName } from '@/utils/formatName';
import { logApiCall } from '@/services/ApiCallLogger';

export type BulkEmailMessage = {
  commLogId: string;
  email: string;
  name: string;
  specimenDetails: string;
  books: { title: string; specimenUrl: string; productId: string; author?: string | null }[];
  batchId: string;
};

const BULK_CHUNK_SIZE = 100;

// ─── Email validation ─────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mxCache = new Map<string, boolean>(); // domain → has MX records

async function isEmailValid(email: string): Promise<boolean> {
  if (!EMAIL_REGEX.test(email)) return false;

  const domain = email.split('@')[1]!.toLowerCase();
  if (mxCache.has(domain)) return mxCache.get(domain)!;

  try {
    const { resolveMx } = await import('dns/promises');
    const records = await resolveMx(domain);
    const valid = records.length > 0;
    mxCache.set(domain, valid);
    return valid;
  } catch {
    mxCache.set(domain, false);
    return false;
  }
}

function buildEmailHtml(
  name: string,
  specimenDetails: string,
  books: { title: string; specimenUrl: string; productId: string; author?: string | null }[]
): string {
  const bookListHtml = books.length > 0
    ? books.map((b) => `<li><strong>${b.title}</strong> by ${formatName(b.author) || 'Pradeep Publications'}</li>`).join('\n')
    : '';
  return `
    <p>Dear ${name},</p>
    <p>We highly value your trust in Pradeep's Books over the years.</p>
    <p>In our endeavour to equip you with our resource material in a better and instant manner, we have now brought for you the digital versions of our following books for your kind review and recommendation:</p>
    ${bookListHtml ? `<ol style="padding-left:20px;">${bookListHtml}</ol>` : ''}
    <p>The access link for the digital copies is shared below for your convenience:</p>
    <p><a href="${specimenDetails}">${specimenDetails}</a></p>
    <p>Appreciating your unwavering patronage and assuring you of our constant and consistent efforts to bring you standard academic books from time to time.</p>
    <p>Pradeep Jain<br/>Chairman</p>
  `;
}

export async function sendEmailBulk(
  messages: BulkEmailMessage[]
): Promise<{ sentIds: string[]; failedIds: string[]; errors: Record<string, string> }> {
  if (config.disableMessaging) {
    console.log(`[ResendService] DISABLE_MESSAGING=true — skipping ${messages.length} emails`);
    return { sentIds: messages.map((m) => m.commLogId), failedIds: [], errors: {} };
  }
  if (!config.resend.apiKey) {
    throw new Error('Resend not configured');
  }

  const { Resend } = await import('resend');
  const resend = new Resend(config.resend.apiKey);
  const from = `${config.resend.fromName} <${config.resend.fromEmail}>`;
  const sentIds: string[] = [];
  const failedIds: string[] = [];
  const errors: Record<string, string> = {};

  // Validate all emails before batching — filter out bad ones up front
  const valid: BulkEmailMessage[] = [];
  await Promise.all(messages.map(async (msg) => {
    const ok = await isEmailValid(msg.email);
    if (ok) {
      valid.push(msg);
    } else {
      const reason = EMAIL_REGEX.test(msg.email) ? `Invalid domain (no MX): ${msg.email}` : `Invalid email format: ${msg.email}`;
      console.warn(`[ResendService] skipping invalid email: ${msg.email} — ${reason}`);
      errors[msg.commLogId] = reason;
      failedIds.push(msg.commLogId);
    }
  }));

  if (valid.length === 0) {
    console.log(`[ResendService] all ${messages.length} emails invalid — nothing to send`);
    return { sentIds, failedIds, errors };
  }

  console.log(`[ResendService] ${valid.length} valid, ${failedIds.length} invalid (of ${messages.length})`);

  for (let i = 0; i < valid.length; i += BULK_CHUNK_SIZE) {
    const chunk = valid.slice(i, i + BULK_CHUNK_SIZE);

    const payload = chunk.map((msg) => ({
      from,
      to: msg.email,
      subject: `Digital Specimen Books from Pradeep Publications`,
      html: buildEmailHtml(msg.name, msg.specimenDetails, msg.books),
    }));

    const t0 = Date.now();
    try {
      const result = await resend.batch.send(payload);
      const latencyMs = Date.now() - t0;

      if (result.error) {
        const errMsg = result.error.message ?? JSON.stringify(result.error);
        console.error(`[ResendService] batch chunk error:`, errMsg);
        for (const msg of chunk) errors[msg.commLogId] = errMsg;
        failedIds.push(...chunk.map((m) => m.commLogId));
        await logApiCall({
          service: 'resend',
          endpoint: '/emails/batch',
          requestBody: { from, count: chunk.length },
          responseBody: result.error,
          statusCode: 400,
          errorMessage: errMsg,
          latencyMs,
          batchId: chunk[0]?.batchId,
          requestCount: chunk.length,
        });
      } else {
        console.log(`[ResendService] batch chunk sent: ${chunk.length} emails`);
        sentIds.push(...chunk.map((m) => m.commLogId));
        await logApiCall({
          service: 'resend',
          endpoint: '/emails/batch',
          requestBody: { from, count: chunk.length },
          responseBody: { ids: result.data?.data?.map((d) => d.id) },
          statusCode: 200,
          latencyMs,
          batchId: chunk[0]?.batchId,
          requestCount: chunk.length,
        });
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      console.error(`[ResendService] batch chunk exception:`, errMsg);
      for (const msg of chunk) errors[msg.commLogId] = errMsg;
      failedIds.push(...chunk.map((m) => m.commLogId));
      await logApiCall({
        service: 'resend',
        endpoint: '/emails/batch',
        requestBody: { from, count: chunk.length },
        statusCode: 500,
        errorMessage: errMsg,
        latencyMs: Date.now() - t0,
        batchId: chunk[0]?.batchId,
        requestCount: chunk.length,
      });
    }
  }

  console.log(`[ResendService] bulk complete: ${sentIds.length} sent, ${failedIds.length} failed (of ${messages.length}, ${messages.length - valid.length} invalid emails skipped)`);
  return { sentIds, failedIds, errors };
}
