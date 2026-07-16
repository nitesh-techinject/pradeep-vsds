import { Elysia, t } from 'elysia';
import { db } from '@/db';
import { watiTemplates } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { config } from '@/config';
import { parseTemplateVariables, resolveParams } from '@/services/TemplateEngine';
import type { TemplateContext } from '@/services/TemplateEngine';

const paramSchema = t.Object({
  paramName: t.String({ minLength: 1 }),
  dataPath: t.String(),
  fallback: t.String(),
});

export const watiTemplateRoutes = new Elysia({ prefix: '/wati-templates' })

  // List all templates
  .get('/', async () => {
    const rows = await db.query.watiTemplates.findMany({
      orderBy: (t, { desc }) => [desc(t.isActive), desc(t.createdAt)],
    });
    return rows;
  })

  // Parse variable names from a body preview
  .post(
    '/parse-variables',
    async ({ body }) => {
      const vars = parseTemplateVariables(body.bodyPreview);
      return { variables: vars };
    },
    {
      body: t.Object({ bodyPreview: t.String() }),
    }
  )

  // Create
  .post(
    '/',
    async ({ body, set }) => {
      try {
        const [row] = await db
          .insert(watiTemplates)
          .values({
            id: nanoid(),
            templateName: body.templateName.trim(),
            displayName: body.displayName.trim(),
            bodyPreview: body.bodyPreview?.trim() ?? null,
            params: body.params ?? [],
            isActive: false,
            bookCount: body.bookCount ?? null,
          })
          .returning();
        return row;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('unique') || msg.includes('duplicate')) {
          set.status = 409;
          return { message: `Template "${body.templateName}" already exists` };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        templateName: t.String({ minLength: 1, maxLength: 200 }),
        displayName: t.String({ minLength: 1, maxLength: 200 }),
        bodyPreview: t.Optional(t.String()),
        params: t.Optional(t.Array(paramSchema)),
        bookCount: t.Optional(t.Nullable(t.Integer({ minimum: 1, maximum: 99 }))),
      }),
    }
  )

  // Update
  .put(
    '/:id',
    async ({ params, body, set }) => {
      const existing = await db.query.watiTemplates.findFirst({
        where: eq(watiTemplates.id, params.id),
      });
      if (!existing) { set.status = 404; return { message: 'Template not found' }; }

      try {
        const [row] = await db
          .update(watiTemplates)
          .set({
            templateName: body.templateName?.trim() ?? existing.templateName,
            displayName: body.displayName?.trim() ?? existing.displayName,
            bodyPreview: body.bodyPreview !== undefined ? body.bodyPreview?.trim() : existing.bodyPreview,
            params: body.params ?? existing.params,
            bookCount: body.bookCount !== undefined ? body.bookCount : existing.bookCount,
            updatedAt: new Date(),
          })
          .where(eq(watiTemplates.id, params.id))
          .returning();
        return row;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('unique') || msg.includes('duplicate')) {
          set.status = 409;
          return { message: 'Template name already exists' };
        }
        throw err;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        templateName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        displayName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        bodyPreview: t.Optional(t.String()),
        params: t.Optional(t.Array(paramSchema)),
        bookCount: t.Optional(t.Nullable(t.Integer({ minimum: 1, maximum: 99 }))),
      }),
    }
  )

  // Activate (independent — does not affect other templates)
  .post(
    '/:id/activate',
    async ({ params, set }) => {
      const existing = await db.query.watiTemplates.findFirst({
        where: eq(watiTemplates.id, params.id),
      });
      if (!existing) { set.status = 404; return { message: 'Template not found' }; }

      const [row] = await db
        .update(watiTemplates)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(watiTemplates.id, params.id))
        .returning();
      return row;
    },
    { params: t.Object({ id: t.String() }) }
  )

  // Deactivate
  .post(
    '/:id/deactivate',
    async ({ params, set }) => {
      const existing = await db.query.watiTemplates.findFirst({
        where: eq(watiTemplates.id, params.id),
      });
      if (!existing) { set.status = 404; return { message: 'Template not found' }; }

      const [row] = await db
        .update(watiTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(watiTemplates.id, params.id))
        .returning();
      return row;
    },
    { params: t.Object({ id: t.String() }) }
  )

  // Preview — resolve params against sample data
  .post(
    '/:id/preview',
    async ({ params, body, set }) => {
      const tmpl = await db.query.watiTemplates.findFirst({
        where: eq(watiTemplates.id, params.id),
      });
      if (!tmpl) { set.status = 404; return { message: 'Template not found' }; }

      const ctx: TemplateContext = {
        teacherName: body.teacherName ?? 'Ramesh Kumar',
        teacherPhone: body.teacherPhone ?? '9876543210',
        teacherEmail: body.teacherEmail ?? 'teacher@school.edu',
        school: body.school ?? 'Delhi Public School',
        city: body.city ?? 'Delhi',
        batchId: body.batchId ?? 'batch-001',
        books: body.books ?? Array.from({ length: 12 }, (_, i) => ({
          title: `Sample Book ${i + 1}`,
          specimenUrl: `https://example.com/dl/${i + 1}`,
          productId: `product-${i + 1}`,
          author: 'Pradeep',
        })),
      };

      const resolved = resolveParams(tmpl.params ?? [], ctx);
      return { templateName: tmpl.templateName, params: resolved };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        teacherName: t.Optional(t.String()),
        teacherPhone: t.Optional(t.String()),
        teacherEmail: t.Optional(t.String()),
        school: t.Optional(t.String()),
        city: t.Optional(t.String()),
        batchId: t.Optional(t.String()),
        books: t.Optional(
          t.Array(
            t.Object({
              title: t.String(),
              specimenUrl: t.String(),
              productId: t.String(),
              author: t.Optional(t.String()),
            })
          )
        ),
      }),
    }
  )

  // Fetch templates from WATI API
  .get(
    '/fetch-from-wati',
    async ({ set, query }) => {
      const { baseUrl, apiKey } = config.wati;
      if (!baseUrl || !apiKey) {
        set.status = 503;
        return { message: 'WATI_BASE_URL and WATI_API_KEY are not configured in .env' };
      }

      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 100;

      const url = `${baseUrl}/api/v1/getMessageTemplates?pageSize=${pageSize}&pageNumber=${page}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const text = await res.text();
        set.status = res.status as 400 | 401 | 403 | 404 | 500;
        return { message: `WATI API error ${res.status}: ${text}` };
      }

      const data = (await res.json()) as {
        result: boolean;
        messageTemplates?: Array<{
          id: string;
          elementName: string;
          status: string;
          body?: string;
          bodyOriginal?: string;
          category?: string;
          language?: string;
          allowTemplateSend?: boolean;
        }>;
        total?: number;
        pageSize?: number;
        pageNumber?: number;
      };

      return {
        templates: data.messageTemplates ?? [],
        total: data.total ?? 0,
        page: data.pageNumber ?? page,
        pageSize: data.pageSize ?? pageSize,
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        pageSize: t.Optional(t.Numeric()),
      }),
    }
  )

  // Delete is intentionally disabled — templates cannot be deleted
  .delete(
    '/:id',
    async ({ set }) => {
      set.status = 403;
      return { message: 'Templates cannot be deleted' };
    },
    { params: t.Object({ id: t.String() }) }
  );
