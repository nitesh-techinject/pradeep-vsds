import { Elysia, t } from 'elysia';
import { db } from '@/db';
import { algoliaProducts } from '@/db/schema';
import { ilike, or, sql, eq } from 'drizzle-orm';
import { config } from '@/config';

type AlgoliaHit = {
  objectID: string;
  title?: string;
  isbn?: string;
  subject?: string;
  grade?: string;
  publisher?: string;
  edition?: string;
  image?: string;
  "mainImage.url"?: string;
  [key: string]: unknown;
};

async function searchAlgolia(query: string): Promise<AlgoliaHit[]> {
  const { appId, apiKey, indexName } = config.algolia;
  if (!appId || !apiKey) return [];

  const res = await fetch(
    `https://${appId}-dsn.algolia.net/1/indexes/${indexName}/query`,
    {
      method: 'POST',
      headers: {
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, hitsPerPage: 50 }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Algolia search failed: ${text}`);
  }

  const data = (await res.json()) as { hits?: AlgoliaHit[] };
  return data.hits ?? [];
}

export const algoliaRoutes = new Elysia({ prefix: '/algolia' })
  // Proxy search to Algolia
  .get(
    '/search',
    async ({ query, set }) => {
      try {
        const hits = await searchAlgolia(query.q ?? '');
        return { hits };
      } catch (err) {
        set.status = 502;
        return { message: err instanceof Error ? err.message : 'Algolia search failed' };
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
      }),
    }
  )

  // List locally cached Algolia products
  .get(
    '/products',
    async ({ query }) => {
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, query.pageSize ?? 50);
      const offset = (page - 1) * pageSize;

      const where = query.search
        ? or(
            ilike(algoliaProducts.title, `%${query.search}%`),
            ilike(algoliaProducts.objectID, `%${query.search}%`),
            ilike(algoliaProducts.isbn, `%${query.search}%`)
          )
        : undefined;

      const [rows, countResult] = await Promise.all([
        db.query.algoliaProducts.findMany({
          where,
          orderBy: (ap, { asc }) => [asc(ap.title)],
          limit: pageSize,
          offset,
        }),
        db.select({ count: sql<number>`count(*)::int` }).from(algoliaProducts).where(where),
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

  // Batch sync / upsert products from Algolia into local cache
  .post(
    '/products/sync',
    async ({ body }) => {
      const { products } = body;
      if (products.length === 0) return { synced: 0 };

      // Deduplicate by objectID (last one wins)
      const deduped = Object.values(
        Object.fromEntries(products.map((p) => [p.objectID, p]))
      );

      const now = new Date();
      await db
        .insert(algoliaProducts)
        .values(
          deduped.map((p) => ({
            objectID: p.objectID,
            title: p.title ?? '',
            isbn: p.isbn ?? null,
            subject: p.subject ?? null,
            grade: p.grade ?? null,
            publisher: p.publisher ?? null,
            coverUrl: p.coverUrl ?? null,
            rawData: p as unknown as Record<string, unknown>,
            syncedAt: now,
          }))
        )
        .onConflictDoUpdate({
          target: algoliaProducts.objectID,
          set: {
            title: sql`excluded.title`,
            isbn: sql`excluded.isbn`,
            subject: sql`excluded.subject`,
            grade: sql`excluded.grade`,
            publisher: sql`excluded.publisher`,
            coverUrl: sql`excluded.cover_url`,
            rawData: sql`excluded.raw_data`,
            syncedAt: sql`excluded.synced_at`,
          },
        });

      return { synced: deduped.length };
    },
    {
      body: t.Object({
        products: t.Array(
          t.Object({
            objectID: t.String(),
            title: t.Optional(t.String()),
            isbn: t.Optional(t.String()),
            subject: t.Optional(t.String()),
            grade: t.Optional(t.String()),
            publisher: t.Optional(t.String()),
            coverUrl: t.Optional(t.String()),
          })
        ),
      }),
    }
  )

  // Delete a cached product (no pre-check — rely on returning() to detect missing)
  .delete(
    '/products/:objectID',
    async ({ params, set }) => {
      const deleted = await db
        .delete(algoliaProducts)
        .where(eq(algoliaProducts.objectID, params.objectID))
        .returning({ objectID: algoliaProducts.objectID });

      if (deleted.length === 0) {
        set.status = 404;
        return { message: 'Product not found' };
      }
      return { success: true };
    },
    {
      params: t.Object({ objectID: t.String() }),
    }
  );
