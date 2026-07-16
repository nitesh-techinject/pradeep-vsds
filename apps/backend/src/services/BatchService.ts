import { eq, and, desc, count, sql, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  batches,
  teachersRaw,
  batchErrors,
  batchLogs,
  commLog,
  type BatchStats,
  type StatusHistoryEntry,
} from '@/db/schema';
import { addJob, QUEUES } from '@/queue';
import { nanoid } from 'nanoid';

type BatchStatus =
  | 'UPLOADED'
  | 'VALIDATING'
  | 'RESOLVING'
  | 'ORDERING'
  | 'MESSAGING'
  | 'COMPLETE'
  | 'PARTIAL_FAILURE'
  | 'PAUSED'
  | 'CANCELLED'
  | 'FAILED';

const ADVANCE_MAP: Partial<Record<BatchStatus, BatchStatus>> = {
  UPLOADED: 'VALIDATING',
  VALIDATING: 'RESOLVING',
  RESOLVING: 'ORDERING',
  ORDERING: 'MESSAGING',
  MESSAGING: 'COMPLETE',
};

export class BatchService {
  static async list(params: {
    page: number;
    pageSize: number;
    status?: string;
  }) {
    const offset = (params.page - 1) * params.pageSize;
    const where = params.status ? eq(batches.status, params.status as BatchStatus) : undefined;

    const [rows, countResult] = await Promise.all([
      db.query.batches.findMany({
        where,
        orderBy: [desc(batches.createdAt)],
        limit: params.pageSize,
        offset,
      }),
      db.select({ total: count() }).from(batches).where(where),
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

  static async getById(id: string) {
    return db.query.batches.findFirst({ where: eq(batches.id, id) });
  }

  static async getBySeqId(seqId: number) {
    if (isNaN(seqId)) return null;
    return db.query.batches.findFirst({ where: eq(batches.seqId, seqId) });
  }

  static async create(fileName?: string) {
    const [{ nextId }] = await db.execute<{ nextId: string }>(sql`SELECT nextval('batches_seq_id_seq')::text AS "nextId"`);
    const rows = await db
      .insert(batches)
      .values({ id: nextId, seqId: parseInt(nextId, 10), fileName, status: 'UPLOADED' })
      .returning();
    const batch = rows[0];
    if (!batch) throw new Error('Failed to create batch');
    return batch;
  }

  static async advance(batchId: string, trigger: string) {
    const batch = await this.getById(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    const status = batch.status as BatchStatus;
    const next = ADVANCE_MAP[status];
    if (!next) throw new Error(`Cannot advance batch from ${status}`);

    return this.transition(batchId, batch, next, trigger);
  }

  static async pause(batchId: string) {
    const batch = await this.getById(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (batch.status === 'PAUSED') return batch;

    const rows = await db
      .update(batches)
      .set({
        status: 'PAUSED',
        pausedFromStage: batch.status,
        pausedAt: new Date(),
        statusHistory: [
          ...(batch.statusHistory ?? []),
          { from: batch.status, to: 'PAUSED', trigger: 'manual', timestamp: new Date().toISOString() },
        ],
        updatedAt: new Date(),
      })
      .where(eq(batches.id, batchId))
      .returning();
    const updated = rows[0];
    if (!updated) throw new Error('Failed to pause batch');
    return updated;
  }

  static async resume(batchId: string) {
    const batch = await this.getById(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (batch.status !== 'PAUSED') throw new Error('Batch is not paused');

    const resumeTarget = (batch.pausedFromStage ?? 'MESSAGING') as BatchStatus;
    return this.transition(batchId, batch, resumeTarget, 'manual_resume');
  }

  static async cancel(batchId: string, reason?: string) {
    const batch = await this.getById(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    const rows = await db
      .update(batches)
      .set({
        status: 'CANCELLED',
        cancelReason: reason ?? 'Cancelled by admin',
        cancelledAt: new Date(),
        statusHistory: [
          ...(batch.statusHistory ?? []),
          { from: batch.status, to: 'CANCELLED', trigger: 'manual', timestamp: new Date().toISOString() },
        ],
        updatedAt: new Date(),
      })
      .where(eq(batches.id, batchId))
      .returning();
    const updated = rows[0];
    if (!updated) throw new Error('Failed to cancel batch');

    // Mark all queued messages as CANCELLED so the messaging worker skips them
    await db
      .update(commLog)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(and(eq(commLog.batchId, batchId), eq(commLog.status, 'QUEUED')));

    // Chain: advance the next batch so cancelling one doesn't block the whole trigger
    const nextBatchId = updated.nextBatchId;
    if (nextBatchId) {
      try {
        await this.advance(nextBatchId, 'auto_chain_after_cancel');
        console.log(`[BatchService] batch=${batchId} CANCELLED → chaining batch=${nextBatchId}`);
      } catch (err) {
        console.warn(`[BatchService] chain advance after cancel for ${nextBatchId} failed:`, err);
      }
    }

    return updated;
  }

  static async updateStats(batchId: string, statsUpdate: Partial<BatchStats>) {
    // Atomic JSON merge — no read-then-write race
    await db
      .update(batches)
      .set({
        stats: sql`COALESCE(stats, '{}') || ${sql.raw(`'${JSON.stringify(statsUpdate).replace(/'/g, "''")}'::jsonb`)}`,
        updatedAt: new Date(),
      })
      .where(eq(batches.id, batchId));
  }

  static async getTeachers(batchId: string, params: { page: number; pageSize: number; status?: string }) {
    const offset = (params.page - 1) * params.pageSize;
    const conditions = [eq(teachersRaw.batchId, batchId)];
    if (params.status) {
      conditions.push(eq(teachersRaw.resolutionStatus, params.status as 'PENDING' | 'RESOLVED' | 'FAILED'));
    }

    const where = and(...conditions);
    const [rows, countResult] = await Promise.all([
      db.query.teachersRaw.findMany({
        where,
        orderBy: [desc(teachersRaw.createdAt)],
        limit: params.pageSize,
        offset,
      }),
      db.select({ total: count() }).from(teachersRaw).where(where),
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

  static async getErrors(batchId: string, params: { page: number; pageSize: number; stage?: string }) {
    const offset = (params.page - 1) * params.pageSize;
    const conditions = [eq(batchErrors.batchId, batchId)];
    if (params.stage) {
      conditions.push(eq(batchErrors.stage, params.stage as 'RESOLUTION' | 'ORDERS' | 'AGGREGATION' | 'MESSAGES'));
    }

    const where = and(...conditions);
    const [rows, countResult] = await Promise.all([
      db.select().from(batchErrors).where(where).orderBy(desc(batchErrors.createdAt)).limit(params.pageSize).offset(offset),
      db.select({ total: count() }).from(batchErrors).where(where),
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

  static async retryErrors(batchId: string, stage?: string) {
    const conditions = [eq(batchErrors.batchId, batchId), eq(batchErrors.isRetryable, true)];
    if (stage) {
      conditions.push(eq(batchErrors.stage, stage as 'RESOLUTION' | 'ORDERS' | 'AGGREGATION' | 'MESSAGES'));
    }

    const errors = await db.select().from(batchErrors).where(and(...conditions));

    let retriedCount = 0;
    for (const err of errors) {
      if (err.stage === 'MESSAGES' && err.commLogId) {
        await addJob(QUEUES.WHATSAPP_MESSAGES, { commLogId: err.commLogId, batchId, retryCount: 0 });
        retriedCount++;
      } else if (err.stage === 'ORDERS' && err.teacherRawId) {
        await addJob(QUEUES.ORDER_CREATION, { batchId, teacherRecordId: err.teacherRawId, retryCount: 0 });
        retriedCount++;
      }
    }

    return { retriedCount };
  }

  static async getLogs(batchId: string, params: { page: number; pageSize: number }) {
    const offset = (params.page - 1) * params.pageSize;
    const where = eq(batchLogs.batchId, batchId);

    const [rows, countResult] = await Promise.all([
      db.select().from(batchLogs).where(where).orderBy(desc(batchLogs.loggedAt)).limit(params.pageSize).offset(offset),
      db.select({ total: count() }).from(batchLogs).where(where),
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

  static async addLog(
    batchId: string,
    step: typeof batchLogs.$inferInsert['step'],
    message: string,
    detail?: string,
    metadata?: Record<string, unknown>,
  ) {
    await db.insert(batchLogs).values({
      id: nanoid(),
      batchId,
      step,
      message,
      detail,
      metadata: metadata ?? undefined,
      loggedAt: new Date(),
    });
  }

  private static async transition(
    batchId: string,
    batch: typeof batches.$inferSelect,
    next: BatchStatus,
    trigger: string
  ) {
    const historyEntry: StatusHistoryEntry = {
      from: batch.status,
      to: next,
      trigger,
      timestamp: new Date().toISOString(),
    };

    // Atomic conditional update — prevents race conditions where two workers
    // try to advance the same batch simultaneously
    const rows = await db
      .update(batches)
      .set({
        status: next,
        statusHistory: sql`COALESCE(status_history, '[]'::jsonb) || ${sql.raw(`'${JSON.stringify([historyEntry]).replace(/'/g, "''")}'::jsonb`)}`,
        resumedAt: next !== 'PAUSED' && batch.status === 'PAUSED' ? new Date() : batch.resumedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(batches.id, batchId), eq(batches.status, batch.status as BatchStatus)))
      .returning();

    if (rows.length === 0) throw new Error(`Batch already transitioned from ${batch.status}`);

    const updated = rows[0]!;

    await addJob(QUEUES.BATCH_ADVANCE, { batchId, targetStage: next });

    // Chain: when a batch completes, auto-start the next queued batch
    if (next === 'COMPLETE') {
      const nextBatchId = updated.nextBatchId;
      if (nextBatchId) {
        try {
          await this.advance(nextBatchId, 'auto_chain');
          console.log(`[BatchService] batch=${batchId} COMPLETE → chaining batch=${nextBatchId}`);
        } catch (err) {
          console.warn(`[BatchService] chain advance for ${nextBatchId} failed (may already be running):`, err);
        }
      }
    }

    return updated;
  }
}
