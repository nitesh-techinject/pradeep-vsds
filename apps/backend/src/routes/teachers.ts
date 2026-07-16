import { Elysia, t } from 'elysia';
import { TeacherService } from '@/services/TeacherService';
import { FirebaseSyncService } from '@/services/FirebaseSyncService';

export const teacherRoutes = new Elysia({ prefix: '/teachers' })
  .get(
    '/',
    ({ query }) =>
      TeacherService.list({
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        search: query.search,
        noContact: query.noContact === 'true',
        phoneOnly: query.phoneOnly === 'true',
        emailOnly: query.emailOnly === 'true',
      }),
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 20 })),
        search: t.Optional(t.String()),
        noContact: t.Optional(t.String()),
        phoneOnly: t.Optional(t.String()),
        emailOnly: t.Optional(t.String()),
      }),
    }
  )
  .get('/:id', async ({ params, set }) => {
    const teacher = await TeacherService.getById(params.id);
    if (!teacher) { set.status = 404; return { message: 'Teacher not found' }; }
    return teacher;
  })
  .patch(
    '/:id/contacts',
    async ({ params, body, set }) => {
      try {
        const result = await TeacherService.addContacts(params.id, body);
        if (result.conflicts.length > 0) {
          set.status = 409;
          return { conflicts: result.conflicts };
        }
        return result.teacher;
      } catch (e) {
        set.status = 400;
        return { message: e instanceof Error ? e.message : 'Failed to update contacts' };
      }
    },
    {
      body: t.Object({
        phone: t.Optional(t.String()),
        email: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/sync-firebase',
    async ({ set }) => {
      try {
        const result = await FirebaseSyncService.syncAll();
        return result;
      } catch (e) {
        set.status = 500;
        return { message: e instanceof Error ? e.message : 'Sync failed' };
      }
    }
  )
  .post(
    '/check-duplicates',
    async ({ body, set }) => {
      try {
        return await TeacherService.checkDuplicates(body.rows);
      } catch (e) {
        set.status = 400;
        return { message: e instanceof Error ? e.message : 'Duplicate check failed' };
      }
    },
    {
      body: t.Object({
        rows: t.Array(t.Object({
          name: t.String(),
          phone: t.String(),
          email: t.String(),
          school: t.String(),
        })),
      }),
    }
  );
