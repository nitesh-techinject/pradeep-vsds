import { Elysia } from 'elysia';
import { db } from '@/db';
import { batches, commLog } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';

export const sseRoutes = new Elysia({ prefix: '/sse' })
  .get('/batches/:batchId/events', async function* ({ params }) {
    const batchId = params.batchId;
    let lastStatus = '';
    let lastProcessed = -1;

    // Stream events every 2 seconds
    while (true) {
      const batch = await db.query.batches.findFirst({
        where: eq(batches.id, batchId),
      });

      if (!batch) {
        yield JSON.stringify({ type: 'error', message: 'Batch not found' });
        return;
      }

      const stats = (batch.stats ?? {}) as Record<string, number>;
      const processed = stats.messagesProcessed ?? stats.ordersCreated ?? 0;

      // Only emit if something changed
      if (batch.status !== lastStatus || processed !== lastProcessed) {
        lastStatus = batch.status;
        lastProcessed = processed;

        yield JSON.stringify({
          type: 'batch:update',
          batchId,
          status: batch.status,
          stats: batch.stats,
          statusHistory: batch.statusHistory,
          timestamp: new Date().toISOString(),
        });
      }

      // Stop streaming when batch is terminal
      if (['COMPLETE', 'CANCELLED', 'FAILED', 'PARTIAL_FAILURE'].includes(batch.status)) {
        yield JSON.stringify({ type: 'batch:complete', batchId, status: batch.status });
        return;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  });
