import { Elysia, t } from 'elysia';
import { BatchService } from '@/services/BatchService';
import { LinkService } from '@/services/LinkService';
import { formatBatchId } from '@/utils/ids';
import { db } from '@/db';
import { orders, commLog, apiCallLogs } from '@/db/schema';
import { eq, and, desc, count, sql } from 'drizzle-orm';

const paginationQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 20 })),
});

/** Resolve seqId → real batch id. If numeric and not found by id, tries seqId lookup. */
async function resolveId(id: string): Promise<string> {
  if (/^\d+$/.test(id)) {
    const batch = await BatchService.getBySeqId(parseInt(id, 10));
    if (batch) return batch.id;
  }
  return id;
}

export const batchRoutes = new Elysia({ prefix: '/batches' })
  .get(
    '/',
    async ({ query }) => {
      const result = await BatchService.list({
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        status: query.status,
      });
      return {
        ...result,
        data: result.data.map((b) => ({ ...b, displayId: formatBatchId(b.seqId) })),
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 20 })),
        status: t.Optional(t.String()),
      }),
    }
  )
  .get('/:id', async ({ params, set }) => {
    // Try by primary id first, then fall back to seq_id lookup
    let batch = await BatchService.getById(params.id);
    if (!batch) batch = await BatchService.getBySeqId(parseInt(params.id, 10));
    if (!batch) { set.status = 404; return { message: 'Batch not found' }; }
    return { ...batch, displayId: formatBatchId(batch.seqId) };
  })
  .post('/:id/advance', async ({ params, set }) => {
    try {
      return await BatchService.advance(await resolveId(params.id), 'manual');
    } catch (e) {
      set.status = 400;
      return { message: e instanceof Error ? e.message : 'Cannot advance batch' };
    }
  })
  .post('/:id/pause', async ({ params, set }) => {
    try {
      return await BatchService.pause(await resolveId(params.id));
    } catch (e) {
      set.status = 400;
      return { message: e instanceof Error ? e.message : 'Cannot pause batch' };
    }
  })
  .post('/:id/resume', async ({ params, set }) => {
    try {
      return await BatchService.resume(await resolveId(params.id));
    } catch (e) {
      set.status = 400;
      return { message: e instanceof Error ? e.message : 'Cannot resume batch' };
    }
  })
  .post(
    '/:id/cancel',
    async ({ params, body, set }) => {
      try {
        return await BatchService.cancel(await resolveId(params.id), body.reason);
      } catch (e) {
        set.status = 400;
        return { message: e instanceof Error ? e.message : 'Cannot cancel batch' };
      }
    },
    { body: t.Object({ reason: t.Optional(t.String()) }) }
  )
  .get(
    '/:id/teachers',
    async ({ params, query }) =>
      BatchService.getTeachers(await resolveId(params.id), {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        status: query.status,
      }),
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 20 })),
        status: t.Optional(t.String()),
      }),
    }
  )
  .get(
    '/:id/errors',
    async ({ params, query }) =>
      BatchService.getErrors(await resolveId(params.id), {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 50,
        stage: query.stage,
      }),
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 50 })),
        stage: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/:id/errors/retry',
    async ({ params, body }) => BatchService.retryErrors(await resolveId(params.id), body.stage),
    { body: t.Object({ stage: t.Optional(t.String()) }) }
  )
  .get(
    '/:id/logs',
    async ({ params, query }) =>
      BatchService.getLogs(await resolveId(params.id), {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 50,
      }),
    { query: paginationQuery }
  )
  // Orders per batch
  .get(
    '/:id/orders',
    async ({ params, query }) => {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 50;
      const offset = (page - 1) * pageSize;
      const batchId = await resolveId(params.id);

      const [rows, countResult] = await Promise.all([
        db.select().from(orders)
          .where(eq(orders.batchId, batchId))
          .orderBy(desc(orders.createdAt))
          .limit(pageSize)
          .offset(offset),
        db.select({ total: count() }).from(orders).where(eq(orders.batchId, batchId)),
      ]);

      // Enrich with message status per teacher
      const enriched = await Promise.all(rows.map(async (order) => {
        const msgs = await db.select({
          channel: commLog.channel,
          status: commLog.status,
          lastError: commLog.lastError,
        }).from(commLog).where(
          and(eq(commLog.batchId, batchId), eq(commLog.teacherRecordId, order.teacherRecordId))
        );

        return {
          ...order,
          loginLink: `https://pradeeppublications.com/digital-content/login?email=${encodeURIComponent(order.teacherEmail ?? '')}&phone=${encodeURIComponent(order.teacherPhone ?? '')}`,
          messages: msgs,
        };
      }));

      return {
        data: enriched,
        total: Number(countResult[0]?.total ?? 0),
        page,
        pageSize,
      };
    },
    { query: t.Object({ page: t.Optional(t.Numeric()), pageSize: t.Optional(t.Numeric()) }) }
  )
  // API call logs for a batch
  .get(
    '/:id/api-logs',
    async ({ params, query }) => {
      const batchId = await resolveId(params.id);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 50;
      const offset = (page - 1) * pageSize;

      const where = query.service
        ? and(eq(apiCallLogs.batchId, batchId), eq(apiCallLogs.service, query.service))
        : eq(apiCallLogs.batchId, batchId);

      const [rows, countResult] = await Promise.all([
        db.select().from(apiCallLogs).where(where).orderBy(desc(apiCallLogs.createdAt)).limit(pageSize).offset(offset),
        db.select({ total: count() }).from(apiCallLogs).where(where),
      ]);

      return {
        data: rows,
        total: Number(countResult[0]?.total ?? 0),
        page,
        pageSize,
        totalPages: Math.ceil(Number(countResult[0]?.total ?? 0) / pageSize),
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 50 })),
        service: t.Optional(t.String()),
      }),
    }
  )
  // Generate specimen links via LMS API
  .post('/:id/links', async ({ params, set }) => {
    try {
      const result = await LinkService.generateForBatch(params.id);
      return { batchId: params.id, ...result };
    } catch (e) {
      set.status = 502;
      return { message: e instanceof Error ? e.message : 'Link generation failed' };
    }
  })
  // Get stored links for a batch
  .get('/:id/links', async ({ params, set }) => {
    const record = await LinkService.getForBatch(params.id);
    if (!record) {
      set.status = 404;
      return { message: 'No links generated yet for this batch' };
    }
    return record;
  })

