import { Elysia, t } from 'elysia';
import { db } from '@/db';
import { bookMappings } from '@/db/schema';
import { eq, ilike, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export const bookMappingRoutes = new Elysia({ prefix: '/book-mappings' })
  // List with optional search
  .get(
    '/',
    async ({ query }) => {
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, query.pageSize ?? 50);
      const offset = (page - 1) * pageSize;

      const where = query.search
        ? or(
            ilike(bookMappings.bookCode, `%${query.search}%`),
            ilike(bookMappings.productTitle, `%${query.search}%`),
            ilike(bookMappings.productId, `%${query.search}%`)
          )
        : undefined;

      const [rows, countResult] = await Promise.all([
        db.query.bookMappings.findMany({
          where,
          orderBy: (bm, { asc }) => [asc(bm.bookCode)],
          limit: pageSize,
          offset,
        }),
        db.select({ count: sql<number>`count(distinct ${bookMappings.bookCode})::int` }).from(bookMappings).where(where),
      ]);

      return {
        data: rows,
        total: countResult[0]?.count ?? 0,
        page,
        pageSize,
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        pageSize: t.Optional(t.Numeric()),
        search: t.Optional(t.String()),
      }),
    }
  )

  // Bulk lookup by book codes (used during upload)
  .post(
    '/lookup',
    async ({ body }) => {
      const { codes } = body;
      if (codes.length === 0) return { mappings: [] };

      const rows = await db.query.bookMappings.findMany({
        where: (bm, { inArray }) => inArray(bm.bookCode, codes),
      });

      return { mappings: rows };
    },
    {
      body: t.Object({ codes: t.Array(t.String()) }),
    }
  )

  // Create — relies on DB unique constraint for race safety
  .post(
    '/',
    async ({ body, set }) => {
      try {
        const [row] = await db
          .insert(bookMappings)
          .values({
            id: nanoid(),
            bookCode: body.bookCode.trim(),
            productId: body.productId.trim(),
            productTitle: body.productTitle.trim(),
            authors: body.authors ?? [],
            notes: body.notes?.trim() ?? null,
            coverUrl: body.coverUrl ?? null,
            edition: body.edition?.trim() ?? null,
          })
          .returning();

        return row;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('unique') || msg.includes('duplicate')) {
          set.status = 409;
          return { message: `Book code "${body.bookCode}" is already mapped to this product` };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        bookCode: t.String({ minLength: 1, maxLength: 200 }),
        productId: t.String({ minLength: 1, maxLength: 200 }),
        productTitle: t.String({ minLength: 1, maxLength: 500 }),
        authors: t.Optional(t.Array(t.Object({ id: t.String(), title: t.String() }))),
        notes: t.Optional(t.String({ maxLength: 1000 })),
        coverUrl: t.Optional(t.String()),
        edition: t.Optional(t.String({ maxLength: 200 })),
      }),
    }
  )

  // Update
  .put(
    '/:id',
    async ({ params, body, set }) => {
      const existing = await db.query.bookMappings.findFirst({
        where: eq(bookMappings.id, params.id),
      });
      if (!existing) {
        set.status = 404;
        return { message: 'Mapping not found' };
      }

      try {
        const [row] = await db
          .update(bookMappings)
          .set({
            bookCode: body.bookCode?.trim() ?? existing.bookCode,
            productId: body.productId?.trim() ?? existing.productId,
            productTitle: body.productTitle?.trim() ?? existing.productTitle,
            authors: body.authors !== undefined ? body.authors : existing.authors,
            notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
            coverUrl: body.coverUrl !== undefined ? body.coverUrl : existing.coverUrl,
            edition: body.edition !== undefined ? (body.edition?.trim() || null) : existing.edition,
            updatedAt: new Date(),
          })
          .where(eq(bookMappings.id, params.id))
          .returning();

        return row;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('unique') || msg.includes('duplicate')) {
          set.status = 409;
          return { message: `This code is already mapped to that product` };
        }
        throw err;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        bookCode: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        productId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        productTitle: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
        authors: t.Optional(t.Array(t.Object({ id: t.String(), title: t.String() }))),
        notes: t.Optional(t.String({ maxLength: 1000 })),
        coverUrl: t.Optional(t.String()),
        edition: t.Optional(t.String({ maxLength: 200 })),
      }),
    }
  )

  // Delete
  .delete(
    '/:id',
    async ({ params, set }) => {
      const deleted = await db
        .delete(bookMappings)
        .where(eq(bookMappings.id, params.id))
        .returning({ id: bookMappings.id });

      if (deleted.length === 0) {
        set.status = 404;
        return { message: 'Mapping not found' };
      }

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
    }
  );
