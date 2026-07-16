/**
 * LinkService — generates specimen links for a batch via the LMS API.
 *
 * Flow:
 *  1. Load all orders for the batch (needs teacherRecordId)
 *  2. Load matching teachersRaw to get book codes (books / booksAssigned)
 *  3. Bulk-lookup book_mappings to resolve codes → productIds
 *  4. Classify each teacher as: users (firebaseId exists) | newUsers (no firebaseId) | mergedUsers (merged duplicate)
 *  5. POST to LMS API with new payload format
 *  6. Parse response and store BookLink[] on each order
 *  7. Persist full link map in batchLinks table
 */
import { db } from '@/db';
import { orders, teachersRaw, teachers, bookMappings, batchLinks, possibleDuplicates } from '@/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { config } from '@/config';
import { nanoid } from 'nanoid';
import { BatchService } from '@/services/BatchService';
import { logApiCall } from '@/services/ApiCallLogger';
import type { BookLink } from '@/db/schema';

type UserMeta = {
  firebaseUserId: string;
  productUrls: Record<string, string>; // productId → url
};

type LmsResponse = {
  batchId: string;
  users: Record<string, UserMeta>;
  newUsers?: Record<string, UserMeta>;
  mergedUsers?: Record<string, UserMeta>;
};

type LmsUserPayload = {
  name: string;
  email: string | null;
  phone: string | null;
  productIds: string[];
};

type LmsRequest = {
  batchId: string;
  users: Record<string, LmsUserPayload>;      // key = firebaseId (existing)
  newUsers?: Record<string, LmsUserPayload>;  // key = teacherRecordId (no firebaseId)
  mergedUsers?: Record<string, LmsUserPayload>; // key = firebaseId (merged duplicate)
};

export class LinkService {
  /**
   * Generate specimen links for every order in a batch.
   * Returns the number of teachers for whom links were generated.
   */
  static async generateForBatch(batchId: string): Promise<{ teacherCount: number; linkCount: number }> {
    // 1. Load all orders in the batch
    const batchOrders = await db.query.orders.findMany({
      where: eq(orders.batchId, batchId),
    });

    if (batchOrders.length === 0) {
      return { teacherCount: 0, linkCount: 0 };
    }

    // 2. Load corresponding teachersRaw rows to get book codes
    const recordIds = batchOrders.map((o) => o.teacherRecordId);
    const rawRows = await db.query.teachersRaw.findMany({
      where: inArray(teachersRaw.id, recordIds),
    });
    const rawByRecordId = new Map(rawRows.map((r) => [r.id, r]));

    // 3. Collect all unique book codes across the batch
    const allCodes = new Set<string>();
    for (const raw of rawRows) {
      const bookStr = raw.books ?? raw.booksAssigned ?? '';
      for (const code of bookStr.split(',')) {
        const c = code.trim();
        if (c) allCodes.add(c);
      }
    }

    if (allCodes.size === 0) {
      return { teacherCount: batchOrders.length, linkCount: 0 };
    }

    // 4. Bulk-lookup book_mappings for all codes
    const mappingRows = await db.query.bookMappings.findMany({
      where: inArray(bookMappings.bookCode, [...allCodes]),
    });
    // code → productId[] (one code can map to multiple products)
    const codeToProducts = new Map<string, string[]>();
    for (const m of mappingRows) {
      const existing = codeToProducts.get(m.bookCode) ?? [];
      existing.push(m.productId);
      codeToProducts.set(m.bookCode, existing);
    }
    // productId → title (for building BookLink after API response)
    const productIdToTitle = new Map(
      mappingRows.map((m) => [m.productId, m.productTitle])
    );
    // productId → coverUrl
    const productIdToCover = new Map(
      mappingRows.map((m) => [m.productId, m.coverUrl ?? undefined])
    );
    // productId → authors joined string
    const productIdToAuthors = new Map(
      mappingRows.map((m) => [
        m.productId,
        (m.authors as Array<{id: string; title: string}> ?? []).map((a) => a.title).join(', '),
      ])
    );

    // 5. Build per-order product ID mapping
    const orderProductMap = new Map<string, string[]>();
    for (const order of batchOrders) {
      const raw = rawByRecordId.get(order.teacherRecordId);
      const bookStr = raw?.books ?? raw?.booksAssigned ?? '';
      const productIds = bookStr
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .flatMap((c) => codeToProducts.get(c) ?? []);

      if (productIds.length > 0) {
        orderProductMap.set(order.id, productIds);
      }
    }

    if (orderProductMap.size === 0) {
      return { teacherCount: batchOrders.length, linkCount: 0 };
    }

    // 6. Load master teacher firebaseIds for all orders
    const masterIds = [...new Set(batchOrders.map((o) => o.teacherMasterId).filter(Boolean))] as string[];
    const masterRows = masterIds.length > 0
      ? await db.query.teachers.findMany({
          where: inArray(teachers.id, masterIds),
          columns: { id: true, firebaseId: true },
        })
      : [];
    const masterFirebaseMap = new Map(masterRows.map((t) => [t.id, t.firebaseId]));

    // 7. Find merged teachers for this batch (possibleDuplicates resolved as MERGED)
    const mergedDups = await db.query.possibleDuplicates.findMany({
      where: and(eq(possibleDuplicates.batchId, batchId), eq(possibleDuplicates.resolution, 'MERGED')),
      columns: { rawTeacherId: true, candidateTeacherId: true },
    });
    // rawTeacherId → firebaseId of the surviving master
    const mergedRawIds = new Set(mergedDups.map((d) => d.rawTeacherId));

    // 8. Process orders in chunks to avoid OOM and oversized API payloads at 10K scale
    const CHUNK_SIZE = 200;
    const { baseUrl, apiKey } = config.lms;
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
    const fullLinkMap: Record<string, Record<string, string>> = {};
    let totalLinks = 0;

    for (let i = 0; i < batchOrders.length; i += CHUNK_SIZE) {
      const chunk = batchOrders.slice(i, i + CHUNK_SIZE);

      const users: Record<string, LmsUserPayload> = {};
      const newUsers: Record<string, LmsUserPayload> = {};
      const mergedUsers: Record<string, LmsUserPayload> = {};

      for (const order of chunk) {
        const productIds = orderProductMap.get(order.id);
        if (!productIds) continue;

        // Skip teachers with no contact info — LMS API requires at least email or phone
        if (!order.teacherEmail && !order.teacherPhone) continue;

        const payload: LmsUserPayload = {
          name: order.teacherName,
          email: order.teacherEmail ?? null,
          phone: order.teacherPhone ?? null,
          productIds,
        };

        const raw = rawByRecordId.get(order.teacherRecordId);
        const firebaseId = order.teacherMasterId ? masterFirebaseMap.get(order.teacherMasterId) : null;

        if (!firebaseId || raw?.isNewTeacher === true) {
          // No firebaseId, OR admin chose "Create New" — send as new user (key by teacherRecordId)
          newUsers[order.teacherRecordId] = payload;
        } else if (mergedRawIds.has(order.teacherRecordId)) {
          // Was a merged duplicate — key by firebaseId
          mergedUsers[firebaseId] = payload;
        } else {
          // Existing user — key by firebaseId
          users[firebaseId] = payload;
        }
      }

      const lmsPayload: LmsRequest = { batchId, users };
      if (Object.keys(newUsers).length > 0) lmsPayload.newUsers = newUsers;
      if (Object.keys(mergedUsers).length > 0) lmsPayload.mergedUsers = mergedUsers;

      if (Object.keys(users).length + Object.keys(newUsers).length + Object.keys(mergedUsers).length === 0) continue;

      // Call LMS API for this chunk
      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/v1/teacher-batch-links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(lmsPayload),
      });
      const latencyMs = Date.now() - t0;

      if (!res.ok) {
        const text = await res.text();
        await logApiCall({
          service: 'lms',
          endpoint: '/v1/teacher-batch-links',
          requestBody: lmsPayload,
          responseBody: { raw: text },
          statusCode: res.status,
          errorMessage: `LMS API error ${res.status}: ${text.slice(0, 200)}`,
          latencyMs,
          batchId,
          requestCount: Object.keys(users).length + Object.keys(newUsers).length + Object.keys(mergedUsers).length,
        });
        throw new Error(`LMS API error ${res.status}: ${text}`);
      }

      const lmsData = (await res.json()) as LmsResponse;

      await logApiCall({
        service: 'lms',
        endpoint: '/v1/teacher-batch-links',
        requestBody: lmsPayload,
        responseBody: lmsData,
        statusCode: res.status,
        latencyMs,
        batchId,
        requestCount: Object.keys(users).length + Object.keys(newUsers).length + Object.keys(mergedUsers).length,
      });

      // Log the full LMS API request & response to batch_logs
      await BatchService.addLog(
        batchId,
        'lms_api',
        `LMS API chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${Object.keys(users).length} users, ${Object.keys(newUsers).length} newUsers, ${Object.keys(mergedUsers).length} mergedUsers → ${Object.keys(lmsData.users ?? {}).length} users, ${Object.keys(lmsData.newUsers ?? {}).length} newUsers, ${Object.keys(lmsData.mergedUsers ?? {}).length} mergedUsers returned`,
        undefined,
        {
          chunkIndex: Math.floor(i / CHUNK_SIZE) + 1,
          chunkSize: CHUNK_SIZE,
          request: lmsPayload,
          response: lmsData,
        },
      );

      // For newUsers: LMS just created them — save firebaseUserId back to teacher record
      // Do this BEFORE building allResponses so we can also index by teacherRecordId
      for (const [teacherRecordId, meta] of Object.entries(lmsData.newUsers ?? {})) {
        if (meta.firebaseUserId) {
          const raw = rawByRecordId.get(teacherRecordId);
          if (raw?.teacherMasterId) {
            await db
              .update(teachers)
              .set({ firebaseId: meta.firebaseUserId, updatedAt: new Date() })
              .where(eq(teachers.id, raw.teacherMasterId));
            // Update local map so subsequent chunks use the new firebaseId
            masterFirebaseMap.set(raw.teacherMasterId, meta.firebaseUserId);
          }
        }
      }

      // Flatten all three response maps into one: lmsKey → UserMeta
      // newUsers are keyed by teacherRecordId in the response — keep that key
      // so order lookup below (which falls back to teacherRecordId for new users) works
      const allResponses = new Map<string, UserMeta>([
        ...Object.entries(lmsData.users ?? {}),
        ...Object.entries(lmsData.newUsers ?? {}),
        ...Object.entries(lmsData.mergedUsers ?? {}),
      ]);

      // Track which teacherRecordIds were new users (response keyed by recordId, not firebaseId)
      const newUserRecordIds = new Set(Object.keys(lmsData.newUsers ?? {}));

      // Update orders in this chunk
      const chunkUpdates: Promise<unknown>[] = [];
      for (const order of chunk) {
        // For new users: response is keyed by teacherRecordId (not the newly-obtained firebaseId)
        const isNewUser = newUserRecordIds.has(order.teacherRecordId);
        const firebaseId = !isNewUser && order.teacherMasterId ? masterFirebaseMap.get(order.teacherMasterId) : null;
        const lmsKey = firebaseId ?? order.teacherRecordId;
        const meta = allResponses.get(lmsKey);
        if (!meta) continue;

        const bookLinkEntries: BookLink[] = Object.entries(meta.productUrls).map(
          ([productId, specimenUrl]) => ({
            productId,
            title: productIdToTitle.get(productId) ?? productId,
            author: productIdToAuthors.get(productId) || undefined,
            coverUrl: productIdToCover.get(productId),
            specimenUrl,
            expiresAt: expiresAt.toISOString(),
          })
        );

        chunkUpdates.push(
          db
            .update(orders)
            .set({
              books: bookLinkEntries,
              totalBooks: bookLinkEntries.length,
              expiresAt,
              status: 'links_generated',
              updatedAt: new Date(),
            })
            .where(eq(orders.id, order.id))
        );

        fullLinkMap[lmsKey] = meta.productUrls;
        totalLinks += bookLinkEntries.length;
      }

      // Flush chunk updates in parallel
      if (chunkUpdates.length > 0) {
        await Promise.all(chunkUpdates);
      }
    }

    // 8. Persist full link map in batchLinks (upsert via batchId unique)
    await db
      .insert(batchLinks)
      .values({
        id: nanoid(),
        batchId,
        links: fullLinkMap,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: batchLinks.batchId,
        set: {
          links: fullLinkMap,
          expiresAt,
          updatedAt: new Date(),
        },
      });

    return { teacherCount: Object.keys(fullLinkMap).length, linkCount: totalLinks };
  }

  /** Retrieve stored links for a batch */
  static async getForBatch(batchId: string) {
    return db.query.batchLinks.findFirst({
      where: eq(batchLinks.batchId, batchId),
    });
  }
}
