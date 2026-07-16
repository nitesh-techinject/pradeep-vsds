import { Elysia, t } from 'elysia';
import { db } from '@/db';
import { batches } from '@/db/schema';
import { desc, sql } from 'drizzle-orm';
import { inArray } from 'drizzle-orm';

export const triggerRoutes = new Elysia({ prefix: '/triggers' })
  .get(
    '/',
    async ({ query }) => {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const offset = (page - 1) * pageSize;

      // Get distinct trigger IDs ordered by earliest batch createdAt desc
      const triggerIdRows = await db
        .selectDistinctOn([batches.triggerId], {
          triggerId: batches.triggerId,
          createdAt: batches.createdAt,
        })
        .from(batches)
        .where(sql`${batches.triggerId} IS NOT NULL`)
        .orderBy(batches.triggerId, desc(batches.createdAt));

      // Also include old batches with no triggerId (treat each as its own trigger)
      const legacyRows = await db
        .select({
          id: batches.id,
          createdAt: batches.createdAt,
        })
        .from(batches)
        .where(sql`${batches.triggerId} IS NULL`)
        .orderBy(desc(batches.createdAt));

      // Combine: triggers first (sorted by creation), then legacy
      type TriggerEntry = { triggerId: string; createdAt: Date };
      const allTriggers: TriggerEntry[] = [
        ...triggerIdRows
          .map((r) => ({ triggerId: r.triggerId!, createdAt: r.createdAt }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        ...legacyRows.map((r) => ({ triggerId: r.id, createdAt: r.createdAt })),
      ];

      const total = allTriggers.length;
      const paginated = allTriggers.slice(offset, offset + pageSize);

      // For each trigger, load all its batches
      const result = await Promise.all(
        paginated.map(async ({ triggerId }) => {
          // Batches with this triggerId OR the single legacy batch
          const batchRows = await db
            .select()
            .from(batches)
            .where(
              sql`${batches.triggerId} = ${triggerId} OR (${batches.triggerId} IS NULL AND ${batches.id} = ${triggerId})`
            )
            .orderBy(batches.seqId);

          const totalTeachers = batchRows.reduce((s, b) => s + ((b.stats as any)?.totalTeachers ?? 0), 0);
          const totalMessages = batchRows.reduce((s, b) => s + ((b.stats as any)?.messagesQueued ?? 0), 0);

          const statuses = batchRows.map((b) => b.status);
          let overallStatus: string;
          if (statuses.every((s) => s === 'COMPLETE')) overallStatus = 'COMPLETE';
          else if (statuses.some((s) => s === 'FAILED')) overallStatus = 'FAILED';
          else if (statuses.some((s) => s === 'PARTIAL_FAILURE')) overallStatus = 'PARTIAL_FAILURE';
          else if (statuses.some((s) => s === 'CANCELLED')) overallStatus = 'CANCELLED';
          else overallStatus = 'IN_PROGRESS';

          return {
            triggerId,
            fileName: batchRows[0]?.fileName ?? null,
            createdAt: batchRows[0]?.createdAt.toISOString() ?? '',
            batchCount: batchRows.length,
            totalTeachers,
            totalMessages,
            overallStatus,
            batches: batchRows.map((b) => ({
              id: b.id,
              seqId: b.seqId,
              status: b.status,
              stats: b.stats,
              createdAt: b.createdAt.toISOString(),
              updatedAt: b.updatedAt.toISOString(),
            })),
          };
        })
      );

      return {
        data: result,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
      }),
    }
  );
