import { eq, and, desc, count, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { failedMessages, commLog, orders } from '@/db/schema';
import { addJob, QUEUES } from '@/queue';

const DIGITAL_CONTENT_BASE = 'https://pradeeppublications.com/digital-content/login';

function buildLoginLink(email: string | null | undefined, phone: string | null | undefined): string {
  const params = new URLSearchParams();
  if (email) params.set('email', email);
  if (phone) params.set('phone', phone);
  return `${DIGITAL_CONTENT_BASE}?${params.toString()}`;
}

export class DLQService {
  static async list(params: {
    page: number;
    pageSize: number;
    batchId?: string;
    channel?: string;
    status?: string;
  }) {
    const offset = (params.page - 1) * params.pageSize;
    const conditions = [];
    if (params.batchId) conditions.push(eq(failedMessages.batchId, params.batchId));
    if (params.channel) conditions.push(eq(failedMessages.channel, params.channel as 'WHATSAPP' | 'EMAIL'));
    // If a specific status is requested show it; otherwise exclude RESOLVED (they've exited the DLQ)
    if (params.status) {
      conditions.push(eq(failedMessages.status, params.status as 'FAILED' | 'RETRYING' | 'RESOLVED'));
    } else {
      conditions.push(ne(failedMessages.status, 'RESOLVED'));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db.select().from(failedMessages).where(where).orderBy(desc(failedMessages.createdAt)).limit(params.pageSize).offset(offset),
      db.select({ total: count() }).from(failedMessages).where(where),
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    return {
      data: rows,
      total,
      page: params.page,
      pageSize: params.pageSize,
      totalPages: Math.ceil(total / params.pageSize),
    };
  }

  static async retry(ids: string[]) {
    if (ids.length === 0) return { retriedCount: 0, skippedCount: 0 };

    const messages = await db
      .select()
      .from(failedMessages)
      .where(and(inArray(failedMessages.id, ids), eq(failedMessages.isRetryable, true)));

    const skippedCount = ids.length - messages.length;
    let retriedCount = 0;

    for (const msg of messages) {
      // Resolve the original commLog to get teacherRecordId
      const log = msg.commLogId
        ? await db.query.commLog.findFirst({ where: eq(commLog.id, msg.commLogId) })
        : null;

      // Look up the order using batchId + teacherRecordId (from commLog) as the source of truth
      const order = log?.teacherRecordId
        ? await db.query.orders.findFirst({
            where: and(
              eq(orders.batchId, msg.batchId!),
              eq(orders.teacherRecordId, log.teacherRecordId)
            ),
          })
        : null;

      if (!order) {
        console.warn(`[DLQ] No order found for commLog=${msg.commLogId} batch=${msg.batchId} — skipping`);
        continue;
      }

      // Rebuild job payload exactly as batchAdvance.worker.ts does
      const loginLink = buildLoginLink(order.teacherEmail, order.teacherPhone);
      const books = (order.books ?? []).map((b: any) => ({
        title: b.title ?? '',
        specimenUrl: loginLink,
        productId: b.productId ?? '',
        author: b.author ?? undefined,
      }));

      if (msg.channel === 'WHATSAPP') {
        await addJob(QUEUES.WHATSAPP_MESSAGES, {
          type: 'WHATSAPP',
          batchId: order.batchId,
          teacherRecordId: order.teacherRecordId,
          teacherMasterId: order.teacherMasterId ?? '',
          phone: order.teacherPhone ?? '',
          name: order.teacherName,
          school: order.school ?? undefined,
          city: order.city ?? undefined,
          email: order.teacherEmail ?? undefined,
          specimenDetails: loginLink,
          commLogId: msg.commLogId ?? '',
          retryCount: 0,
          books,
        });
      } else {
        await addJob(QUEUES.EMAIL_MESSAGES, {
          type: 'EMAIL',
          batchId: order.batchId,
          teacherRecordId: order.teacherRecordId,
          teacherMasterId: order.teacherMasterId ?? '',
          email: order.teacherEmail ?? '',
          name: order.teacherName,
          specimenDetails: loginLink,
          commLogId: msg.commLogId ?? '',
          retryCount: 0,
          books,
        });
      }

      // Reset commLog to QUEUED
      if (msg.commLogId) {
        await db.update(commLog)
          .set({ status: 'QUEUED', lastError: null, updatedAt: new Date() })
          .where(eq(commLog.id, msg.commLogId));
      }

      await db
        .update(failedMessages)
        .set({ status: 'RETRYING', retriedAt: new Date(), updatedAt: new Date() })
        .where(eq(failedMessages.id, msg.id));

      retriedCount++;
    }

    return { retriedCount, skippedCount };
  }

  static async delete(ids: string[]) {
    if (ids.length === 0) return { deletedCount: 0 };
    await db.delete(failedMessages).where(inArray(failedMessages.id, ids));
    return { deletedCount: ids.length };
  }

  static async deleteAll(batchId?: string) {
    const conditions = batchId ? [eq(failedMessages.batchId, batchId)] : [];
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const result = await db.delete(failedMessages).where(where).returning({ id: failedMessages.id });
    return { deletedCount: result.length };
  }

  static async retryAll(batchId?: string) {
    const conditions = [eq(failedMessages.isRetryable, true), eq(failedMessages.status, 'FAILED')];
    if (batchId) conditions.push(eq(failedMessages.batchId, batchId));

    const messages = await db
      .select()
      .from(failedMessages)
      .where(and(...conditions))
      .limit(500);

    return this.retry(messages.map((m) => m.id));
  }
}
