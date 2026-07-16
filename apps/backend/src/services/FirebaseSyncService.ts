import { db } from '@/db';
import { teachers, orders } from '@/db/schema';
import { isNull, eq, inArray, and } from 'drizzle-orm';
import { config } from '@/config';
import { BatchService } from '@/services/BatchService';

interface GetUsersUidPayload {
  batchId: string;
  users: Record<string, { email?: string | null; phone?: string | null }>;
}

interface GetUsersUidResponse {
  batchId: string;
  users: Record<string, { firebaseUserId: string | null; status: 'FOUND' | 'NOT_FOUND' }>;
}

const BATCH_SIZE = 50;
const PARALLEL = 4;
const FETCH_TIMEOUT_MS = 30_000; // 30s per chunk

/** Fire-and-forget log — never blocks the main flow */
function log(batchId: string | undefined, message: string, detail?: string) {
  if (!batchId) return;
  BatchService.addLog(batchId, 'aggregation', message, detail).catch((e) =>
    console.warn('[FirebaseSync] log write failed:', e)
  );
}

async function fetchFirebaseUids(
  payload: GetUsersUidPayload,
  batchId?: string,
  chunkIndex?: number
): Promise<GetUsersUidResponse> {
  const userCount = Object.keys(payload.users).length;

  log(
    batchId,
    `[Firebase Sync] Request #${chunkIndex ?? 0}: sending ${userCount} users`,
    JSON.stringify(payload, null, 2)
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let responseText: string;
  let res: Response;
  try {
    res = await fetch(config.firebaseSyncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.lms.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    responseText = await res.text();
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    log(
      batchId,
      `[Firebase Sync] Request #${chunkIndex ?? 0}: HTTP ${res.status} error`,
      responseText
    );
    throw new Error(`Firebase sync API error ${res.status}: ${responseText}`);
  }

  let parsed: GetUsersUidResponse;
  try {
    parsed = JSON.parse(responseText) as GetUsersUidResponse;
  } catch {
    throw new Error(`Firebase sync API returned invalid JSON: ${responseText}`);
  }

  const found = Object.values(parsed.users).filter((u) => u.status === 'FOUND').length;
  const notFound = Object.values(parsed.users).filter((u) => u.status === 'NOT_FOUND').length;
  log(
    batchId,
    `[Firebase Sync] Response #${chunkIndex ?? 0}: ${found} FOUND, ${notFound} NOT_FOUND`,
    JSON.stringify(parsed, null, 2)
  );

  return parsed;
}

export class FirebaseSyncService {
  /** Sync only teachers belonging to a specific batch that don't yet have a firebaseId */
  static async syncForBatch(batchId: string): Promise<{ updated: number; notFound: number; total: number }> {
    const batchOrders = await db.query.orders.findMany({
      where: eq(orders.batchId, batchId),
      columns: { teacherMasterId: true },
    });

    const masterIds = [...new Set(batchOrders.map((o) => o.teacherMasterId).filter(Boolean))] as string[];
    if (masterIds.length === 0) return { updated: 0, notFound: 0, total: 0 };

    const rows = await db.query.teachers.findMany({
      where: and(inArray(teachers.id, masterIds), isNull(teachers.firebaseId)),
      columns: { id: true, emails: true, phones: true },
    });

    if (rows.length === 0) return { updated: 0, notFound: 0, total: 0 };

    return this._sync(rows, undefined, batchId);
  }

  static async syncAll(onProgress?: (done: number, total: number) => void): Promise<{
    updated: number;
    notFound: number;
    total: number;
  }> {
    const rows = await db.query.teachers.findMany({
      where: isNull(teachers.firebaseId),
      columns: { id: true, emails: true, phones: true },
    });
    return this._sync(rows, onProgress);
  }

  private static async _sync(
    rows: { id: string; emails: string[]; phones: string[] }[],
    onProgress?: (done: number, total: number) => void,
    batchId?: string
  ): Promise<{ updated: number; notFound: number; total: number }> {
    const total = rows.length;
    let updated = 0;
    let notFound = 0;
    let done = 0;

    const totalChunks = Math.ceil(total / BATCH_SIZE);
    log(
      batchId,
      `[Firebase Sync] Starting: ${total} teachers in ${totalChunks} chunk(s) of ${BATCH_SIZE}, ${PARALLEL} parallel`
    );

    const chunks: (typeof rows)[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      chunks.push(rows.slice(i, i + BATCH_SIZE));
    }

    for (let i = 0; i < chunks.length; i += PARALLEL) {
      const group = chunks.slice(i, i + PARALLEL);

      const results = await Promise.all(
        group.map((chunk, idx) => {
          const syncBatchId = `sync_${Date.now()}_${i + idx}`;
          const chunkIndex = i + idx + 1;
          const users: GetUsersUidPayload['users'] = {};
          for (const t of chunk) {
            const email = t.emails?.[t.emails.length - 1] ?? null;
            const phone = t.phones?.[t.phones.length - 1] ?? null;
            // Skip teachers with no contact info — API requires at least one
            if (!email && !phone) continue;
            users[t.id] = { email, phone };
          }
          if (Object.keys(users).length === 0) {
            return Promise.resolve({ batchId: syncBatchId, users: {} } as GetUsersUidResponse);
          }
          return fetchFirebaseUids({ batchId: syncBatchId, users }, batchId, chunkIndex);
        })
      );

      // Collect all FOUND updates and run them in parallel
      const updatePromises: Promise<unknown>[] = [];
      for (const res of results) {
        for (const [teacherId, data] of Object.entries(res.users)) {
          if (data.status === 'FOUND' && data.firebaseUserId) {
            updatePromises.push(
              db
                .update(teachers)
                .set({ firebaseId: data.firebaseUserId, updatedAt: new Date() })
                .where(eq(teachers.id, teacherId))
            );
            updated++;
          } else {
            notFound++;
          }
          done++;
          onProgress?.(done, total);
        }
      }
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }
    }

    log(
      batchId,
      `[Firebase Sync] Complete: ${updated} updated, ${notFound} not found (of ${total} total)`
    );

    return { updated, notFound, total };
  }
}
