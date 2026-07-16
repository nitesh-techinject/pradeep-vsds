import { eq, desc, count, ilike, or, inArray, sql, and, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { teachers, phoneLookup, emailLookup } from '@/db/schema';

type Teacher = typeof teachers.$inferSelect;

type TeacherRef = {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
  school: string;
  city: string;
  firebaseId?: string | null;
};

export interface DuplicateMatch {
  rowIndex: number;
  row: { name: string; phone: string; email: string; school: string };
  existingTeacher: TeacherRef;
  confidence: number;
  matchReasons: string[];
  diff: {
    nameConflict: boolean;       // name in file differs from name in DB
    phonesToAdd: string[];       // phones from file not yet in DB
    emailsToAdd: string[];       // emails from file not yet in DB
    schoolConflict: boolean;     // school differs
    noChanges: boolean;          // everything already in DB, pure duplicate
  };
  // Set when phone and email match DIFFERENT teachers in the DB
  isSplitMatch?: boolean;
  phoneMatchTeacher?: TeacherRef;
  emailMatchTeacher?: TeacherRef;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^0+/, '');
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export class TeacherService {
  static async list(params: { page: number; pageSize: number; search?: string; noContact?: boolean; phoneOnly?: boolean; emailOnly?: boolean }) {
    const offset = (params.page - 1) * params.pageSize;

    const searchCond = params.search
      ? or(
          ilike(teachers.name, `%${params.search}%`),
          ilike(teachers.school, `%${params.search}%`),
          ilike(teachers.city, `%${params.search}%`),
          ilike(teachers.firebaseId, `%${params.search}%`),
          // phones/emails are JSONB arrays — search as text
          sql`${teachers.phones}::text ilike ${'%' + params.search + '%'}`,
          sql`${teachers.emails}::text ilike ${'%' + params.search + '%'}`
        )
      : undefined;

    // phones/emails stored as double-encoded JSONB strings: empty = NULL or '"[]"'
    const emptyPhone = sql`(${teachers.phones} IS NULL OR ${teachers.phones}::text = '"[]"')`;
    const hasPhone   = sql`NOT (${teachers.phones} IS NULL OR ${teachers.phones}::text = '"[]"')`;
    const emptyEmail = sql`(${teachers.emails} IS NULL OR ${teachers.emails}::text = '"[]"')`;
    const hasEmail   = sql`NOT (${teachers.emails} IS NULL OR ${teachers.emails}::text = '"[]"')`;

    const contactCond = params.noContact
      ? sql`${emptyPhone} AND ${emptyEmail}`
      : params.phoneOnly
      ? sql`${hasPhone} AND ${emptyEmail}`
      : params.emailOnly
      ? sql`${hasEmail} AND ${emptyPhone}`
      : undefined;

    const where = searchCond && contactCond
      ? and(searchCond, contactCond)
      : searchCond ?? contactCond;

    const [rows, countResult] = await Promise.all([
      db.query.teachers.findMany({
        where,
        orderBy: [desc(teachers.updatedAt)],
        limit: params.pageSize,
        offset,
      }),
      db.select({ total: count() }).from(teachers).where(where),
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

  static async getById(id: string): Promise<Teacher | undefined> {
    return db.query.teachers.findFirst({ where: eq(teachers.id, id) });
  }

  static async findByPhone(phone: string): Promise<Teacher | undefined> {
    const normalized = normalizePhone(phone);
    const lookup = await db.query.phoneLookup.findFirst({
      where: eq(phoneLookup.phone, normalized),
    });
    if (!lookup) return undefined;
    return db.query.teachers.findFirst({ where: eq(teachers.id, lookup.teacherId) });
  }

  static async findByEmail(email: string): Promise<Teacher | undefined> {
    const normalized = normalizeEmail(email);
    const lookup = await db.query.emailLookup.findFirst({
      where: eq(emailLookup.email, normalized),
    });
    if (!lookup) return undefined;
    return db.query.teachers.findFirst({ where: eq(teachers.id, lookup.teacherId) });
  }

  /**
   * Upsert a teacher — find by phone/email or create new.
   * Returns { teacher, isNew }
   */
  static async upsert(data: {
    name: string;
    phone?: string;
    email?: string;
    school?: string;
    city?: string;
    recordId?: string;
    booksAssigned?: string;
    teacherOwnerId?: string;
    teacherOwner?: string;
    firstName?: string;
    lastName?: string;
    salutation?: string;
    institutionId?: string;
    institutionName?: string;
  }): Promise<{ teacher: Teacher; isNew: boolean }> {
    let existing: Teacher | undefined;

    if (data.phone) existing = await this.findByPhone(data.phone);
    if (!existing && data.email) existing = await this.findByEmail(data.email);

    const effectiveSchool = data.school || data.institutionName;

    if (existing) {
      const phones = new Set(existing.phones);
      const emails = new Set(existing.emails);
      if (data.phone) phones.add(normalizePhone(data.phone));
      if (data.email) emails.add(normalizeEmail(data.email));

      const rows = await db
        .update(teachers)
        .set({
          phones: [...phones],
          emails: [...emails],
          school: effectiveSchool ?? existing.school,
          city: data.city ?? existing.city,
          updatedAt: new Date(),
        })
        .where(eq(teachers.id, existing.id))
        .returning();

      const updated = rows[0] ?? existing;
      await this.syncLookups(updated.id, [...phones], [...emails]);

      return { teacher: updated, isNew: false };
    }

    const [{ nextId }] = await db.execute<{ nextId: string }>(sql`SELECT nextval('teachers_seq_id_seq')::text AS "nextId"`);
    const id = nextId;
    const phones = data.phone ? [normalizePhone(data.phone)] : [];
    const emails = data.email ? [normalizeEmail(data.email)] : [];

    const rows = await db
      .insert(teachers)
      .values({
        id,
        seqId: parseInt(id, 10),
        name: data.name,
        phones,
        emails,
        school: effectiveSchool,
        city: data.city,
        recordId: data.recordId,
        booksAssigned: data.booksAssigned,
        teacherOwnerId: data.teacherOwnerId,
        teacherOwner: data.teacherOwner,
        firstName: data.firstName,
        lastName: data.lastName,
        salutation: data.salutation,
        institutionId: data.institutionId,
        institutionName: data.institutionName,
      })
      .returning();

    const teacher = rows[0];
    if (!teacher) throw new Error('Failed to create teacher');

    await this.syncLookups(id, phones, emails);

    return { teacher, isNew: true };
  }

  /**
   * Batch duplicate check. NEVER auto-merges — every match is returned for admin approval.
   * Confidence: phone=95%, email=90%, fuzzy name+school=60–75%.
   * Each match includes a diff showing exactly what would change on merge.
   */
  static async checkDuplicates(
    rows: { name: string; phone: string; email: string; school: string }[]
  ): Promise<{ matches: DuplicateMatch[]; total: number }> {

    // ---- 1. Batch exact lookups ----
    const rawPhones = [...new Set(rows.map(r => normalizePhone(r.phone)).filter(Boolean))];
    const rawEmails = [...new Set(rows.map(r => normalizeEmail(r.email)).filter(Boolean))];

    const [phoneRows, emailRows] = await Promise.all([
      rawPhones.length > 0 ? db.query.phoneLookup.findMany({ where: inArray(phoneLookup.phone, rawPhones) }) : [],
      rawEmails.length > 0 ? db.query.emailLookup.findMany({ where: inArray(emailLookup.email, rawEmails) }) : [],
    ]);

    const phoneToTeacherId = new Map(phoneRows.map(p => [p.phone, p.teacherId]));
    const emailToTeacherId = new Map(emailRows.map(e => [e.email, e.teacherId]));

    const matchedIds = [...new Set([...phoneToTeacherId.values(), ...emailToTeacherId.values()])];
    const matchedTeachers = matchedIds.length > 0
      ? await db.query.teachers.findMany({ where: inArray(teachers.id, matchedIds) })
      : [];
    const teacherMap = new Map(matchedTeachers.map(t => [t.id, t]));

    // ---- 2. Build matches with diff ----
    const matches: DuplicateMatch[] = [];
    const unmatchedIdxs: number[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const normPhone = normalizePhone(row.phone);
      const normEmail = normalizeEmail(row.email);
      let teacherId: string | undefined;
      let confidence = 0;
      const matchReasons: string[] = [];

      let phoneMatched = false;
      let emailMatched = false;

      const phoneTeacherId = normPhone ? phoneToTeacherId.get(normPhone) : undefined;
      const emailTeacherId = normEmail ? emailToTeacherId.get(normEmail) : undefined;

      // Match on phone or email — no name/school requirement
      if (phoneTeacherId) {
        teacherId = phoneTeacherId;
        phoneMatched = true;
        matchReasons.push('Phone match');
      }
      if (emailTeacherId) {
        if (!teacherId) teacherId = emailTeacherId;
        emailMatched = true;
        matchReasons.push('Email match');
      }

      if (phoneMatched && emailMatched) confidence = 100;
      else if (phoneMatched) confidence = 95;
      else if (emailMatched) confidence = 90;

      if (teacherId) {
        const teacher = teacherMap.get(teacherId)!;
        if (teacher) {
          const phonesToAdd = normPhone && !teacher.phones.includes(normPhone) ? [normPhone] : [];
          const emailsToAdd = normEmail && !teacher.emails.includes(normEmail) ? [normEmail] : [];
          const nameConflict = !!row.name && row.name.trim().toLowerCase() !== teacher.name.trim().toLowerCase();
          const schoolConflict = !!row.school && !!teacher.school &&
            row.school.trim().toLowerCase() !== teacher.school.trim().toLowerCase();
          const noChanges = !nameConflict && !schoolConflict && phonesToAdd.length === 0 && emailsToAdd.length === 0;

          const toRef = (t: Teacher): TeacherRef => ({
            id: t.id, name: t.name, phones: t.phones, emails: t.emails,
            school: t.school ?? '', city: t.city ?? '', firebaseId: t.firebaseId ?? null,
          });

          const match: DuplicateMatch = {
            rowIndex: i, row,
            existingTeacher: toRef(teacher),
            confidence, matchReasons,
            diff: { nameConflict, phonesToAdd, emailsToAdd, schoolConflict, noChanges },
          };

          matches.push(match);
        }
      }
    }

    matches.sort((a, b) => a.rowIndex - b.rowIndex);
    return { matches, total: matches.length };
  }

  /**
   * Add phone/email to a teacher who has no contacts.
   * Checks uniqueness: rejects if the phone/email is already owned by a DIFFERENT teacher.
   */
  static async addContacts(
    teacherId: string,
    data: { phone?: string; email?: string }
  ): Promise<{ teacher: Teacher; conflicts: { field: 'phone' | 'email'; ownerId: string; ownerName: string }[] }> {
    const teacher = await this.getById(teacherId);
    if (!teacher) throw new Error('Teacher not found');

    const conflicts: { field: 'phone' | 'email'; ownerId: string; ownerName: string }[] = [];

    const normPhone = data.phone ? normalizePhone(data.phone) : undefined;
    const normEmail = data.email ? normalizeEmail(data.email) : undefined;

    // Uniqueness checks
    if (normPhone) {
      const existing = await db.query.phoneLookup.findFirst({ where: eq(phoneLookup.phone, normPhone) });
      if (existing && existing.teacherId !== teacherId) {
        const owner = await this.getById(existing.teacherId);
        conflicts.push({ field: 'phone', ownerId: existing.teacherId, ownerName: owner?.name ?? 'Unknown' });
      }
    }
    if (normEmail) {
      const existing = await db.query.emailLookup.findFirst({ where: eq(emailLookup.email, normEmail) });
      if (existing && existing.teacherId !== teacherId) {
        const owner = await this.getById(existing.teacherId);
        conflicts.push({ field: 'email', ownerId: existing.teacherId, ownerName: owner?.name ?? 'Unknown' });
      }
    }

    if (conflicts.length > 0) {
      return { teacher, conflicts };
    }

    // Apply updates
    const newPhones = new Set(teacher.phones ?? []);
    const newEmails = new Set(teacher.emails ?? []);
    if (normPhone) newPhones.add(normPhone);
    if (normEmail) newEmails.add(normEmail);

    const [updated] = await db
      .update(teachers)
      .set({
        phones: [...newPhones],
        emails: [...newEmails],
        ...(normPhone && !teacher.phones?.length ? { phone: normPhone } : {}),
        ...(normEmail && !teacher.emails?.length ? { email: normEmail } : {}),
        updatedAt: new Date(),
      })
      .where(eq(teachers.id, teacherId))
      .returning();

    await this.syncLookups(teacherId, [...newPhones], [...newEmails]);

    return { teacher: updated, conflicts: [] };
  }

  private static async syncLookups(teacherId: string, phones: string[], emails: string[]) {
    if (phones.length > 0) {
      await db
        .insert(phoneLookup)
        .values(phones.map((phone) => ({ phone, teacherId })))
        .onConflictDoNothing();
    }
    if (emails.length > 0) {
      await db
        .insert(emailLookup)
        .values(emails.map((email) => ({ email, teacherId })))
        .onConflictDoNothing();
    }
  }
}
