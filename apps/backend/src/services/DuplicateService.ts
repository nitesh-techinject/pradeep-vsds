import { eq, and, desc, count, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { possibleDuplicates, teachersRaw, teachers } from '@/db/schema';

type TeacherRecord = {
  name: string;
  phone: string;
  email: string;
  school: string;
  city: string;
  recordId?: string;
  booksAssigned?: string;
  teacherOwnerId?: string;
  teacherOwner?: string;
  firstName?: string;
  lastName?: string;
  institutionId?: string;
  institutionName?: string;
  salutation?: string;
};

type RawRow = typeof teachersRaw.$inferSelect;
type TeacherRow = typeof teachers.$inferSelect;

function rawToRecord(r: RawRow): TeacherRecord {
  return {
    name: r.name ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    school: r.school ?? '',
    city: r.city ?? '',
    recordId: r.recordId ?? undefined,
    booksAssigned: r.booksAssigned ?? r.books ?? undefined,
    teacherOwnerId: r.teacherOwnerId ?? undefined,
    teacherOwner: r.teacherOwner ?? undefined,
    firstName: r.firstName ?? undefined,
    lastName: r.lastName ?? undefined,
    institutionId: r.institutionId ?? undefined,
    institutionName: r.institutionName ?? undefined,
    salutation: r.salutation ?? undefined,
  };
}

function teacherToRecord(t: TeacherRow): TeacherRecord {
  return {
    name: t.name,
    // arrays store primary as last element
    phone: t.phones?.[t.phones.length - 1] ?? '',
    email: t.emails?.[t.emails.length - 1] ?? '',
    school: t.school ?? '',
    city: t.city ?? '',
    recordId: t.recordId ?? undefined,
    booksAssigned: t.booksAssigned ?? undefined,
    teacherOwnerId: t.teacherOwnerId ?? undefined,
    teacherOwner: t.teacherOwner ?? undefined,
    firstName: t.firstName ?? undefined,
    lastName: t.lastName ?? undefined,
    institutionId: t.institutionId ?? undefined,
    institutionName: t.institutionName ?? undefined,
    salutation: t.salutation ?? undefined,
  };
}

export class DuplicateService {
  static async list(params: {
    page: number;
    pageSize: number;
    batchId?: string;
    resolution?: string;
  }) {
    const offset = (params.page - 1) * params.pageSize;
    const conditions = [];
    if (params.batchId) conditions.push(eq(possibleDuplicates.batchId, params.batchId));
    if (params.resolution) {
      conditions.push(eq(possibleDuplicates.resolution, params.resolution as 'PENDING' | 'MERGED' | 'KEPT_SEPARATE'));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(possibleDuplicates)
        .where(where)
        .orderBy(desc(possibleDuplicates.createdAt))
        .limit(params.pageSize)
        .offset(offset),
      db.select({ total: count() }).from(possibleDuplicates).where(where),
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    // incoming_record / existing_record jsonb columns are not populated at insert
    // time — hydrate them from the referenced raw + master teacher rows so the
    // frontend diff view always has records to render.
    const rawIds = [...new Set(rows.map((r) => r.rawTeacherId).filter((v): v is string => !!v))];
    const candidateIds = [...new Set(rows.map((r) => r.candidateTeacherId).filter((v): v is string => !!v))];

    const [rawRows, teacherRows] = await Promise.all([
      rawIds.length ? db.select().from(teachersRaw).where(inArray(teachersRaw.id, rawIds)) : Promise.resolve([]),
      candidateIds.length ? db.select().from(teachers).where(inArray(teachers.id, candidateIds)) : Promise.resolve([]),
    ]);

    const rawMap = new Map(rawRows.map((r) => [r.id, rawToRecord(r)]));
    const teacherMap = new Map(teacherRows.map((t) => [t.id, teacherToRecord(t)]));

    const data = rows.map((r) => ({
      ...r,
      incomingRecord: r.incomingRecord ?? (r.rawTeacherId ? rawMap.get(r.rawTeacherId) ?? null : null),
      existingRecord: r.existingRecord ?? (r.candidateTeacherId ? teacherMap.get(r.candidateTeacherId) ?? null : null),
    }));

    return {
      data,
      total,
      page: params.page,
      pageSize: params.pageSize,
      totalPages: Math.ceil(total / params.pageSize),
    };
  }

  static async resolve(
    id: string,
    resolution: 'MERGED' | 'KEPT_SEPARATE',
    reviewedBy = 'admin'
  ) {
    const dup = await db.query.possibleDuplicates.findFirst({
      where: eq(possibleDuplicates.id, id),
    });
    if (!dup) throw new Error(`Duplicate ${id} not found`);
    if (dup.resolution !== 'PENDING') throw new Error('Already resolved');

    const rows = await db
      .update(possibleDuplicates)
      .set({
        resolution,
        reviewedBy,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(possibleDuplicates.id, id))
      .returning();

    const updated = rows[0];
    if (!updated) throw new Error('Failed to resolve duplicate');

    if (resolution === 'MERGED' && dup.rawTeacherId && dup.candidateTeacherId) {
      await db
        .update(teachersRaw)
        .set({
          teacherMasterId: dup.candidateTeacherId,
          resolutionStatus: 'RESOLVED',
          updatedAt: new Date(),
        })
        .where(eq(teachersRaw.id, dup.rawTeacherId));
    }

    return updated;
  }
}
