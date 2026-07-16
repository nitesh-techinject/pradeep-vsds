import { Elysia, t } from 'elysia';
import { DuplicateService } from '@/services/DuplicateService';

export const duplicateRoutes = new Elysia({ prefix: '/duplicates' })
  .get(
    '/',
    ({ query }) =>
      DuplicateService.list({
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        batchId: query.batchId,
        resolution: query.resolution,
      }),
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 20 })),
        batchId: t.Optional(t.String()),
        resolution: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/:id/resolve',
    async ({ params, body, set }) => {
      try {
        return await DuplicateService.resolve(params.id, body.resolution, body.reviewedBy);
      } catch (e) {
        set.status = 400;
        return { message: e instanceof Error ? e.message : 'Resolution failed' };
      }
    },
    {
      body: t.Object({
        resolution: t.Union([t.Literal('MERGED'), t.Literal('KEPT_SEPARATE')]),
        reviewedBy: t.Optional(t.String()),
      }),
    }
  );
