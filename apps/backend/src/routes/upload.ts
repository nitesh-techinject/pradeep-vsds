import { Elysia, t } from 'elysia';
import { processUpload, processReviewedRows, type MergeDecisionPayload, type ReviewedRow } from '@/services/UploadService';
import { db } from '@/db';
import { commLog, batches } from '@/db/schema';
import { desc, sql } from 'drizzle-orm';

export const uploadRoutes = new Elysia({ prefix: '/upload' })
  .post(
    '/',
    async ({ body, set }) => {
      try {
        const file = body.file;
        const channel = body.channel as 'whatsapp' | 'email' | 'both' | undefined;
        const parseField = <T>(field: string | undefined, name: string): T | undefined => {
          if (!field) return undefined;
          try { return JSON.parse(field) as T; }
          catch (e) { console.warn(`[upload] Failed to parse ${name}:`, e); return undefined; }
        };

        // Elysia auto-parses JSON strings in multipart bodies, so teacherChannels
        // may arrive as a string (raw JSON) or already-parsed array
        const rawTc = body.teacherChannels;
        const teacherChannels: ('whatsapp' | 'email' | 'both')[] | undefined = Array.isArray(rawTc)
          ? rawTc as ('whatsapp' | 'email' | 'both')[]
          : typeof rawTc === 'string'
            ? parseField<('whatsapp' | 'email' | 'both')[]>(rawTc, 'teacherChannels')
            : undefined;
        const rawMd = body.mergeDecisions;
        const mergeDecisions: MergeDecisionPayload[] | undefined = Array.isArray(rawMd)
          ? rawMd as MergeDecisionPayload[]
          : typeof rawMd === 'string'
            ? parseField<MergeDecisionPayload[]>(rawMd, 'mergeDecisions')
            : undefined;
        const rawSk = body.skippedRowIndices;
        const skippedRowIndices: number[] | undefined = Array.isArray(rawSk)
          ? rawSk as number[]
          : typeof rawSk === 'string'
            ? parseField<number[]>(rawSk, 'skippedRowIndices')
            : undefined;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return await processUpload(buffer, file.name ?? 'upload.xlsx', channel, teacherChannels, mergeDecisions, skippedRowIndices);
      } catch (e) {
        set.status = 400;
        return { message: e instanceof Error ? e.message : 'Upload failed' };
      }
    },
    {
      body: t.Object({
        file: t.File(),
        channel: t.Optional(t.String()),
        teacherChannels: t.Optional(t.Union([t.String(), t.Array(t.Any())])),
        mergeDecisions: t.Optional(t.Union([t.String(), t.Array(t.Any())])),
        skippedRowIndices: t.Optional(t.Union([t.String(), t.Array(t.Any())])),
      }),
    }
  )
  .post(
    '/reviewed',
    async ({ body, set }) => {
      try {
        return await processReviewedRows(body.rows as ReviewedRow[], body.fileName);
      } catch (e) {
        set.status = 400;
        return { message: e instanceof Error ? e.message : 'Upload failed' };
      }
    },
    {
      body: t.Object({
        rows: t.Array(t.Any()),
        fileName: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/message-history',
    async ({ body, set }) => {
      try {
        const teachers = body.teachers as Array<{ rowIndex: number; phone?: string; email?: string }>;

        const phones = teachers.map((t) => t.phone).filter((p): p is string => !!p);
        const emails = teachers.map((t) => t.email).filter((e): e is string => !!e);

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        // Query commLog directly — it is the canonical record for ALL sends
        // (bulk WhatsApp, bulk email, DLQ retries). messageSendLog only exists for retries.
        const historyRecords = phones.length > 0 || emails.length > 0
          ? await db
              .select({
                teacherPhone: commLog.teacherPhone,
                teacherEmail: commLog.teacherEmail,
                channel: commLog.channel,
                sentAt: sql<Date>`COALESCE(${commLog.lastAttemptAt}, ${commLog.updatedAt})`,
                status: commLog.status,
                books: commLog.books,
                batchSeqId: batches.seqId,
                batchFileName: batches.fileName,
              })
              .from(commLog)
              .leftJoin(batches, sql`${commLog.batchId} = ${batches.id}`)
              .where(
                sql`${commLog.status} = 'SENT'
                  AND COALESCE(${commLog.lastAttemptAt}, ${commLog.updatedAt}) > ${threeMonthsAgo.toISOString()}::timestamptz
                  AND (${
                    phones.length > 0
                      ? sql`${commLog.teacherPhone} IN (${sql.join(phones.map(p => sql`${p}`), sql`, `)})`
                      : sql`FALSE`
                  } OR ${
                    emails.length > 0
                      ? sql`${commLog.teacherEmail} IN (${sql.join(emails.map(e => sql`${e}`), sql`, `)})`
                      : sql`FALSE`
                  })`
              )
              .orderBy(desc(commLog.lastAttemptAt))
          : [];

        type HistoryEntry = { sentAt: string; status: string; books: string | null; batchSeqId: number | null; batchFileName: string | null; sendCount: number };

        // Group by contact + channel → keep most recent, track total send count
        const latestByContact = new Map<string, HistoryEntry>();
        const sendCountMap = new Map<string, number>();

        for (const rec of historyRecords) {
          if (rec.channel === 'WHATSAPP' && rec.teacherPhone) {
            const key = `wa:${rec.teacherPhone}`;
            sendCountMap.set(key, (sendCountMap.get(key) ?? 0) + 1);
            if (!latestByContact.has(key)) {
              latestByContact.set(key, { sentAt: rec.sentAt as unknown as string, status: rec.status, books: rec.books ?? null, batchSeqId: rec.batchSeqId ?? null, batchFileName: rec.batchFileName ?? null, sendCount: 0 });
            }
          }
          if (rec.channel === 'EMAIL' && rec.teacherEmail) {
            const key = `em:${rec.teacherEmail}`;
            sendCountMap.set(key, (sendCountMap.get(key) ?? 0) + 1);
            if (!latestByContact.has(key)) {
              latestByContact.set(key, { sentAt: rec.sentAt as unknown as string, status: rec.status, books: rec.books ?? null, batchSeqId: rec.batchSeqId ?? null, batchFileName: rec.batchFileName ?? null, sendCount: 0 });
            }
          }
        }
        // Patch sendCount into each entry
        for (const [key, entry] of latestByContact) {
          entry.sendCount = sendCountMap.get(key) ?? 1;
        }

        // Map back to rowIndex
        const results: Record<number, { whatsapp: HistoryEntry | null; email: HistoryEntry | null }> = {};

        for (const teacher of teachers) {
          const wa = teacher.phone ? latestByContact.get(`wa:${teacher.phone}`) : null;
          const em = teacher.email ? latestByContact.get(`em:${teacher.email}`) : null;
          results[teacher.rowIndex] = {
            whatsapp: wa ?? null,
            email: em ?? null,
          };
        }

        return { results };
      } catch (e) {
        console.error('[upload/message-history]', e);
        set.status = 500;
        return { message: e instanceof Error ? e.message : 'Failed to check message history' };
      }
    },
    {
      body: t.Object({
        teachers: t.Array(t.Any()),
      }),
    }
  );
