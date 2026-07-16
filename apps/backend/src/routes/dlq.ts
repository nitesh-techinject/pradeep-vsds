import { Elysia, t } from 'elysia';
import { DLQService } from '@/services/DLQService';

export const dlqRoutes = new Elysia({ prefix: '/dlq' })
  .get(
    '/',
    async ({ query }) => {
      return DLQService.list({
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        batchId: query.batchId,
        channel: query.channel,
        status: query.status,
      });
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 1000, default: 20 })),
        batchId: t.Optional(t.String()),
        channel: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/retry',
    async ({ body }) => {
      if (body.retryAll) {
        return DLQService.retryAll(body.batchId);
      }
      return DLQService.retry(body.ids ?? []);
    },
    {
      body: t.Object({
        ids: t.Optional(t.Array(t.String())),
        retryAll: t.Optional(t.Boolean()),
        batchId: t.Optional(t.String()),
      }),
    }
  )
  .delete(
    '/',
    async ({ body }) => {
      if (body.deleteAll) {
        return DLQService.deleteAll(body.batchId);
      }
      return DLQService.delete(body.ids ?? []);
    },
    {
      body: t.Object({
        ids: t.Optional(t.Array(t.String())),
        deleteAll: t.Optional(t.Boolean()),
        batchId: t.Optional(t.String()),
      }),
    }
  );
