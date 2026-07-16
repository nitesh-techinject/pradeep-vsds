/**
 * Batch Advance Worker -- orchestrates batch stage transitions.
 *
 * VALIDATING -> queues ORDER_CREATION for all teachers, advances batch to ORDERING
 * ORDERING   -> no-op; ordering.worker processes individual teachers
 * MESSAGING  -> fetches specimen links, creates commLogs, sends WhatsApp in bulk, queues emails
 * COMPLETE   -> logs completion
 */
import { createHash } from 'crypto';
import { createWorker, addJob, QUEUES } from '@/queue';
import type { BatchAdvanceJob } from '@/queue/types';
import type { Job } from 'bullmq';
import { db } from '@/db';
import { teachersRaw, orders, commLog, batches, failedMessages, batchErrors, messageSendLog } from '@/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import type { BatchStats } from '@/db/schema';
import { nanoid } from 'nanoid';
import { LinkService } from '@/services/LinkService';
import { BatchService } from '@/services/BatchService';
import { FirebaseSyncService } from '@/services/FirebaseSyncService';
import { sendWhatsAppBulk, type BulkWAMessage } from '@/services/WatiService';
import { sendEmailBulk, type BulkEmailMessage } from '@/services/ResendService';

// Stage ordering -- used to skip stale messages
const STAGE_ORDER: Record<string, number> = {
  UPLOADED: 0, VALIDATING: 1, RESOLVING: 2, ORDERING: 3, MESSAGING: 4, COMPLETE: 5,
  PAUSED: -1, CANCELLED: -1, FAILED: -1, PARTIAL_FAILURE: -1,
};

// --- VALIDATING: queue ORDER_CREATION for all raw teachers ---

async function handleValidating(batchId: string) {
  const rawTeachers = await db.query.teachersRaw.findMany({
    where: eq(teachersRaw.batchId, batchId),
  });

  if (rawTeachers.length === 0) {
    await BatchService.addLog(batchId, 'validation', 'No teachers found in batch -- nothing to process');
    return;
  }

  // Set expected order count in batch stats
  await BatchService.updateStats(batchId, {
    totalTeachers: rawTeachers.length,
    expectedOrders: rawTeachers.length,
    ordersCreated: 0,
  });

  // Queue an ORDER_CREATION job for every teacher
  for (const teacher of rawTeachers) {
    await addJob(QUEUES.ORDER_CREATION, {
      batchId,
      teacherRecordId: teacher.id,
      teacherMasterId: teacher.teacherMasterId ?? '',
      retryCount: 0,
    });
  }

  await BatchService.addLog(
    batchId,
    'validation',
    `Queued ${rawTeachers.length} order creation jobs`,
    `${rawTeachers.length} teachers will be resolved and ordered`
  );

  // Advance batch directly to ORDERING (bypass RESOLVING stage to avoid recursive publish)
  await db
    .update(batches)
    .set({ status: 'ORDERING', updatedAt: new Date() })
    .where(eq(batches.id, batchId));

  console.log(`[batch-advance] batch=${batchId} -> ORDERING (${rawTeachers.length} jobs queued)`);
}

// --- MESSAGING: fetch links, create commLogs, bulk-send WhatsApp, queue emails ---

const DIGITAL_CONTENT_BASE = 'https://pradeeppublications.com/digital-content/login';

function buildLoginLink(email: string | null, phone: string | null): string {
  const params = new URLSearchParams();
  if (email) params.set('email', email);
  if (phone) params.set('phone', phone);
  return `${DIGITAL_CONTENT_BASE}?${params.toString()}`;
}

async function handleMessaging(batchId: string) {
  // Sync Firebase UIDs for teachers in this batch before sending messages
  try {
    const syncResult = await FirebaseSyncService.syncForBatch(batchId);
    if (syncResult.total > 0) {
      await BatchService.addLog(
        batchId,
        'aggregation',
        `Firebase UID sync: ${syncResult.updated} updated, ${syncResult.notFound} not found (of ${syncResult.total})`
      );
    }
  } catch (err) {
    // Non-fatal — log and continue
    console.warn(`[batch-advance] batch=${batchId} Firebase sync failed (non-fatal):`, err);
    await BatchService.addLog(batchId, 'aggregation', `Firebase UID sync skipped: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  await BatchService.addLog(batchId, 'aggregation', 'Generating specimen links from LMS API...');

  // 1. Call LMS API to generate specimen links — REQUIRED before sending messages
  const linkResult = await LinkService.generateForBatch(batchId);
  await BatchService.addLog(
    batchId,
    'aggregation_complete',
    `Links generated: ${linkResult.teacherCount} teachers, ${linkResult.linkCount} total links`
  );
  console.log(`[batch-advance] batch=${batchId} links: ${linkResult.linkCount} across ${linkResult.teacherCount} teachers`);

  // 2. Load all orders (now enriched with book links from LMS)
  const batchOrders = await db.query.orders.findMany({
    where: eq(orders.batchId, batchId),
  });

  if (batchOrders.length === 0) {
    await BatchService.addLog(batchId, 'error', 'No orders found -- cannot queue messages');
    return;
  }

  await BatchService.addLog(batchId, 'aggregation_complete', `${batchOrders.length} teachers ready for messaging`);

  const waBulkMessages: BulkWAMessage[] = [];
  const emailBulkMessages: BulkEmailMessage[] = [];

  for (const order of batchOrders) {
    const loginLink = buildLoginLink(order.teacherEmail, order.teacherPhone);
    const booksList = (order.books ?? []).map((b) => b.title).join(', ');

    // --- WhatsApp: collect for bulk send ---
    if (order.sendWhatsApp && order.teacherPhone) {
      const hash = createHash('sha256')
        .update(`${order.teacherPhone}:${batchId}:WHATSAPP`)
        .digest('hex');

      const [waInserted] = await db
        .insert(commLog)
        .values({
          id: hash,
          messageHash: hash,
          batchId,
          teacherMasterId: order.teacherMasterId ?? undefined,
          teacherRecordId: order.teacherRecordId,
          channel: 'WHATSAPP',
          teacherPhone: order.teacherPhone,
          teacherName: order.teacherName,
          books: booksList,
          status: 'QUEUED',
        })
        .onConflictDoNothing()
        .returning({ id: commLog.id });

      if (waInserted) {
        waBulkMessages.push({
          commLogId: hash,
          phone: order.teacherPhone,
          name: order.teacherName,
          school: order.school ?? undefined,
          city: order.city ?? undefined,
          email: order.teacherEmail ?? undefined,
          batchId,
          books: (order.books ?? []).map((b) => ({
            title: b.title,
            specimenUrl: loginLink,
            productId: b.productId,
            author: b.author ?? undefined,
          })),
        });
      }
    }

    // --- Email: collect for bulk send ---
    if (order.sendEmail && order.teacherEmail) {
      const hash = createHash('sha256')
        .update(`${order.teacherEmail}:${batchId}:EMAIL`)
        .digest('hex');

      const [emailInserted] = await db
        .insert(commLog)
        .values({
          id: hash,
          messageHash: hash,
          batchId,
          teacherMasterId: order.teacherMasterId ?? undefined,
          teacherRecordId: order.teacherRecordId,
          channel: 'EMAIL',
          teacherEmail: order.teacherEmail,
          teacherName: order.teacherName,
          books: booksList,
          status: 'QUEUED',
        })
        .onConflictDoNothing()
        .returning({ id: commLog.id });

      if (emailInserted) {
        emailBulkMessages.push({
          commLogId: hash,
          email: order.teacherEmail,
          name: order.teacherName,
          specimenDetails: loginLink,
          batchId,
          books: (order.books ?? []).map((b) => ({
            title: b.title,
            specimenUrl: loginLink,
            productId: b.productId,
            author: b.author ?? undefined,
          })),
        });
      }
    }
  }

  // 3. Send all WhatsApp messages in bulk
  const waTotal = waBulkMessages.length;
  let waSent = 0;
  let waFailed = 0;

  if (waTotal > 0) {
    await BatchService.addLog(batchId, 'outbox_queued', `Sending ${waTotal} WhatsApp messages in bulk...`);
    const { sentIds, failedIds, errors: waErrors } = await sendWhatsAppBulk(waBulkMessages);
    waSent = sentIds.length;
    waFailed = failedIds.length;

    const now = new Date();

    if (sentIds.length > 0) {
      await db
        .update(commLog)
        .set({ status: 'SENT', attemptCount: 1, lastAttemptAt: now, updatedAt: now })
        .where(inArray(commLog.id, sentIds));

      const sentMsgMap = new Map(waBulkMessages.map((m) => [m.commLogId, m]));
      await db.insert(messageSendLog).values(
        sentIds.map((commLogId) => {
          const msg = sentMsgMap.get(commLogId)!;
          return {
            id: nanoid(),
            commLogId,
            batchId,
            channel: 'WHATSAPP' as const,
            teacherPhone: msg.phone,
            teacherName: msg.name,
            attemptNumber: 1,
            status: 'sent',
          };
        })
      ).onConflictDoNothing();
    }

    if (failedIds.length > 0) {
      // Insert DLQ entries so the user can retry from the failed messages page
      const msgMap = new Map(waBulkMessages.map((m) => [m.commLogId, m]));
      for (const commLogId of failedIds) {
        const msg = msgMap.get(commLogId);
        if (!msg) continue;
        const errMsg = waErrors[commLogId] ?? 'Bulk send failed';
        await db
          .update(commLog)
          .set({ status: 'DLQ', lastError: errMsg, updatedAt: now })
          .where(eq(commLog.id, commLogId));
        await db.insert(failedMessages).values({
          id: nanoid(),
          commLogId,
          batchId,
          channel: 'WHATSAPP',
          teacherPhone: msg.phone,
          errorType: 'UNKNOWN',
          errorMessage: errMsg,
          attemptCount: 1,
          isRetryable: true,
          status: 'FAILED',
        }).onConflictDoNothing();
      }
    }

    console.log(`[batch-advance] batch=${batchId} bulk WA: ${waSent} sent, ${waFailed} failed`);
    await BatchService.addLog(
      batchId,
      'batch_advanced',
      `WhatsApp bulk send complete: ${waSent} sent, ${waFailed} failed`
    );
  }

  // 3b. Send all emails in bulk
  const emailTotal = emailBulkMessages.length;
  let emailSent = 0;
  let emailFailed = 0;

  if (emailTotal > 0) {
    await BatchService.addLog(batchId, 'outbox_queued', `Sending ${emailTotal} emails in bulk...`);
    const { sentIds: emailSentIds, failedIds: emailFailedIds, errors: emailErrors } = await sendEmailBulk(emailBulkMessages);
    emailSent = emailSentIds.length;
    emailFailed = emailFailedIds.length;

    const now = new Date();

    if (emailSentIds.length > 0) {
      await db
        .update(commLog)
        .set({ status: 'SENT', attemptCount: 1, lastAttemptAt: now, updatedAt: now })
        .where(inArray(commLog.id, emailSentIds));

      const sentEmailMap = new Map(emailBulkMessages.map((m) => [m.commLogId, m]));
      await db.insert(messageSendLog).values(
        emailSentIds.map((commLogId) => {
          const msg = sentEmailMap.get(commLogId)!;
          return {
            id: nanoid(),
            commLogId,
            batchId,
            channel: 'EMAIL' as const,
            teacherEmail: msg.email,
            teacherName: msg.name,
            attemptNumber: 1,
            status: 'sent',
          };
        })
      ).onConflictDoNothing();
    }

    if (emailFailedIds.length > 0) {
      const emailMap = new Map(emailBulkMessages.map((m) => [m.commLogId, m]));
      for (const commLogId of emailFailedIds) {
        const msg = emailMap.get(commLogId);
        if (!msg) continue;
        const errMsg = emailErrors[commLogId] ?? 'Email send failed';
        await db
          .update(commLog)
          .set({ status: 'DLQ', lastError: errMsg, updatedAt: now })
          .where(eq(commLog.id, commLogId));
        await db.insert(failedMessages).values({
          id: nanoid(),
          commLogId,
          batchId,
          channel: 'EMAIL',
          teacherEmail: msg.email,
          errorType: 'UNKNOWN',
          errorMessage: errMsg,
          attemptCount: 1,
          isRetryable: true,
          status: 'FAILED',
        }).onConflictDoNothing();
      }
    }

    console.log(`[batch-advance] batch=${batchId} bulk email: ${emailSent} sent, ${emailFailed} failed`);
    await BatchService.addLog(
      batchId,
      'batch_advanced',
      `Email bulk send complete: ${emailSent} sent, ${emailFailed} failed`
    );
  }

  // 4. Atomically set messagesQueued and INCREMENT messagesProcessed by (waTotal + emailTotal).
  const totalQueued = waTotal + emailTotal;

  const [statsRow] = await db
    .update(batches)
    .set({
      stats: sql`jsonb_set(
        jsonb_set(
          COALESCE(stats, '{}'::jsonb),
          '{messagesQueued}',
          to_jsonb(${totalQueued}::int)
        ),
        '{messagesProcessed}',
        to_jsonb(COALESCE((stats->>'messagesProcessed')::int, 0) + ${waTotal + emailTotal}::int)
      )`,
      updatedAt: new Date(),
    })
    .where(eq(batches.id, batchId))
    .returning();

  await BatchService.addLog(
    batchId,
    'batch_advanced',
    `Messaging: ${waSent} WA sent, ${waFailed} WA failed, ${emailSent} email sent, ${emailFailed} email failed`
  );

  console.log(`[batch-advance] batch=${batchId} -> MESSAGING done: WA=${waSent}/${waTotal}, email=${emailSent}/${emailTotal}`);

  // 5. Advance to COMPLETE if all messages already processed.
  //    Covers: (a) no messages at all, (b) no emails queued, (c) email worker
  //    raced ahead and finished before we set messagesQueued above.
  const stats = statsRow?.stats as BatchStats | undefined;
  const processed = stats?.messagesProcessed ?? 0;
  const queued = stats?.messagesQueued ?? 0;

  if (queued === 0 || processed >= queued) {
    try {
      await BatchService.advance(batchId, 'auto_messaging_complete');
      console.log(`[batch-advance] batch=${batchId} all ${queued} messages processed -> COMPLETE`);
    } catch {
      // Already advanced — safe to ignore
    }
  }
}

// --- BullMQ Worker ---

createWorker<BatchAdvanceJob>(QUEUES.BATCH_ADVANCE, async (job: Job<BatchAdvanceJob>) => {
  const { batchId, targetStage } = job.data;
  console.log(`[batch-advance] batch=${batchId} stage=${targetStage}`);

  const batch = await BatchService.getById(batchId);
  if (!batch) {
    console.warn(`[batch-advance] batch=${batchId} not found -- skipping`);
    return;
  }

  const currentOrder = STAGE_ORDER[batch.status] ?? -1;
  const targetOrder = STAGE_ORDER[targetStage] ?? -1;

  // Skip stale messages -- batch has already moved past this stage
  if (currentOrder > targetOrder) {
    console.log(`[batch-advance] batch=${batchId} already at ${batch.status} -- skipping stale ${targetStage} message`);
    return;
  }

  try {
    switch (targetStage) {
      case 'VALIDATING':
      case 'RESOLVING':
        await handleValidating(batchId);
        break;
      case 'ORDERING':
        await BatchService.addLog(batchId, 'ordering', 'Ordering stage started -- processing teachers');
        break;
      case 'MESSAGING':
        await handleMessaging(batchId);
        break;
      case 'COMPLETE':
        await BatchService.addLog(batchId, 'batch_advanced', 'Batch marked complete');
        break;
      default:
        console.log(`[batch-advance] No handler for stage=${targetStage}`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[batch-advance] batch=${batchId} stage=${targetStage} FAILED:`, errorMessage);

    // Mark batch as FAILED
    try {
      await db
        .update(batches)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(batches.id, batchId));

      await BatchService.addLog(batchId, 'error', `Stage ${targetStage} failed: ${errorMessage}`);

      await db.insert(batchErrors).values({
        id: nanoid(),
        batchId,
        stage: targetStage,
        errorType: 'STAGE_FAILED',
        errorMessage,
        isRetryable: true,
      }).onConflictDoNothing();
    } catch (dbErr) {
      console.error(`[batch-advance] Failed to record batch failure:`, dbErr);
    }

    // Always advance the chain so remaining batches in the trigger are not blocked
    if (batch.nextBatchId) {
      try {
        await BatchService.advance(batch.nextBatchId, 'auto_chain_after_failure');
        console.log(`[batch-advance] batch=${batchId} FAILED → chaining batch=${batch.nextBatchId}`);
      } catch (chainErr) {
        console.warn(`[batch-advance] chain advance after failure failed:`, chainErr);
      }
    }

    // Don't rethrow — error recorded in DB, chain advanced
  }
});

console.log('[batch-advance] Ready');
