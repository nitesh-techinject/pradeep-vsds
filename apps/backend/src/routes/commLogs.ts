import { Elysia, t } from 'elysia';
import { db } from '@/db';
import { commLog, batches } from '@/db/schema';
import { eq, and, desc, count, or, ilike } from 'drizzle-orm';
import { BatchService } from '@/services/BatchService';

export const commLogRoutes = new Elysia({ prefix: '/comm-logs' })
  // GET /comm-logs — paginated list + per-batch summary
  .get(
    '/',
    async ({ query }) => {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 50;
      const offset = (page - 1) * pageSize;

      // Resolve batchId: if it looks numeric, try seqId lookup first
      let resolvedBatchId = query.batchId;
      if (resolvedBatchId && /^\d+$/.test(resolvedBatchId)) {
        const batch = await BatchService.getBySeqId(parseInt(resolvedBatchId, 10));
        if (batch) resolvedBatchId = batch.id;
      }

      // Build where clause
      const conditions = [];
      if (resolvedBatchId) conditions.push(eq(commLog.batchId, resolvedBatchId));
      if (query.channel) conditions.push(eq(commLog.channel, query.channel as 'WHATSAPP' | 'EMAIL'));
      if (query.status) conditions.push(eq(commLog.status, query.status as 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'DLQ' | 'CANCELLED' | 'SKIPPED'));
      if (query.contact) {
        const pattern = `%${query.contact}%`;
        conditions.push(or(ilike(commLog.teacherPhone, pattern), ilike(commLog.teacherEmail, pattern))!);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      // Paginated log entries
      const rows = await db.query.commLog.findMany({
        where,
        orderBy: [desc(commLog.updatedAt)],
        limit: pageSize,
        offset,
      });

      // Total count
      const [{ total }] = await db
        .select({ total: count() })
        .from(commLog)
        .where(where);

      // Per-batch summary (counts by status)
      const batchSummaryRows = await db
        .select({
          batchId: commLog.batchId,
          status: commLog.status,
          cnt: count(),
        })
        .from(commLog)
        .where(resolvedBatchId ? eq(commLog.batchId, resolvedBatchId) : undefined)
        .groupBy(commLog.batchId, commLog.status);

      // Aggregate per batch
      const batchMap = new Map<string, {
        batchId: string;
        queued: number;
        sent: number;
        delivered: number;
        failed: number;
        dlq: number;
        total: number;
      }>();

      for (const row of batchSummaryRows) {
        if (!batchMap.has(row.batchId)) {
          batchMap.set(row.batchId, { batchId: row.batchId, queued: 0, sent: 0, delivered: 0, failed: 0, dlq: 0, total: 0 });
        }
        const entry = batchMap.get(row.batchId)!;
        const n = Number(row.cnt);
        entry.total += n;
        switch (row.status) {
          case 'QUEUED': entry.queued += n; break;
          case 'SENT': entry.sent += n; break;
          case 'DELIVERED': entry.delivered += n; break;
          case 'FAILED': entry.failed += n; break;
          case 'DLQ': entry.dlq += n; break;
        }
      }

      // Fetch batch filenames for display
      const batchIds = [...batchMap.keys()];
      let batchInfoMap = new Map<string, { fileName: string; seqId: number }>();
      if (batchIds.length > 0) {
        const batchRows = await db.query.batches.findMany({
          where: (b, { inArray }) => inArray(b.id, batchIds),
          columns: { id: true, fileName: true, status: true, createdAt: true, seqId: true },
        });
        for (const b of batchRows) {
          batchInfoMap.set(b.id, { fileName: b.fileName ?? b.id, seqId: b.seqId });
        }
      }

      const batchSummary = [...batchMap.values()]
        .map((s) => ({
          ...s,
          fileName: batchInfoMap.get(s.batchId)?.fileName ?? s.batchId,
          seqId: batchInfoMap.get(s.batchId)?.seqId ?? 0,
        }))
        .sort((a, b) => b.seqId - a.seqId);

      return {
        data: rows.map((r) => ({
          id: r.id,
          batchId: r.batchId,
          channel: r.channel,
          teacherName: r.teacherName,
          teacherPhone: r.teacherPhone,
          teacherEmail: r.teacherEmail,
          books: r.books,
          status: r.status,
          attemptCount: r.attemptCount,
          lastError: r.lastError,
          externalMessageId: r.externalMessageId,
          lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        total: Number(total),
        page,
        pageSize,
        batchSummary,
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 500, default: 50 })),
        batchId: t.Optional(t.String()),
        channel: t.Optional(t.String()),
        status: t.Optional(t.String()),
        contact: t.Optional(t.String()),
      }),
    }
  );
