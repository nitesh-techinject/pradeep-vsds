import { eq, and, desc, count } from 'drizzle-orm';
import { db } from '@/db';
import { possibleDuplicates, teachersRaw } from '@/db/schema';

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

    return {
      data: rows,
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
