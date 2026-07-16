import * as XLSX from 'xlsx';
import { db } from '@/db';
import { teachersRaw, teachers, phoneLookup, emailLookup, batches, possibleDuplicates } from '@/db/schema';
import { BatchService } from './BatchService';
import { nanoid } from 'nanoid';
import { eq, inArray } from 'drizzle-orm';

export type MergeDecisionPayload =
  | {
      rowIndex: number;
      action: 'merge';
      teacherId: string;
      nameChoice: 'file' | 'db';
      noChanges: boolean;
      phonesToAdd: string[];
      emailsToAdd: string[];
      newName?: string;
    }
  | { rowIndex: number; action: 'create_new' };

export type UploadRow = {
  name?: string;
  phone?: string;
  email?: string;
  school?: string;
  city?: string;
  books?: string;
  recordId?: string;
  booksAssigned?: string;
  teacherOwnerId?: string;
  teacherOwner?: string;
  firstName?: string;
  lastName?: string;
  institutionId?: string;
  institutionName?: string;
  salutation?: string;
  sendWhatsApp?: boolean;
  sendEmail?: boolean;
};

const COLUMN_ALIASES: Record<string, keyof UploadRow> = {
  name: 'name',
  teacher_name: 'name',
  teachername: 'name',
  'teacher name': 'name',
  phone: 'phone',
  mobile: 'phone',
  'mobile no': 'phone',
  'phone no': 'phone',
  phoneno: 'phone',
  email: 'email',
  'email id': 'email',
  emailid: 'email',
  school: 'school',
  'school name': 'school',
  schoolname: 'school',
  city: 'city',
  location: 'city',
  books: 'books',
  'book list': 'books',
  booklist: 'books',
  record_id: 'recordId',
  recordid: 'recordId',
  'record id': 'recordId',
  books_assigned: 'booksAssigned',
  booksassigned: 'booksAssigned',
  'books assigned': 'booksAssigned',
  teacher_owner_id: 'teacherOwnerId',
  teacherownerid: 'teacherOwnerId',
  'teacher owner id': 'teacherOwnerId',
  teacher_owner: 'teacherOwner',
  teacherowner: 'teacherOwner',
  'teacher owner': 'teacherOwner',
  first_name: 'firstName',
  firstname: 'firstName',
  'first name': 'firstName',
  last_name: 'lastName',
  lastname: 'lastName',
  'last name': 'lastName',
  institution_id: 'institutionId',
  institutionid: 'institutionId',
  'institution id': 'institutionId',
  'institution name.id': 'institutionId',
  'instituition name.id': 'institutionId',
  "instituition's__id": 'institutionId',
  institution_name: 'institutionName',
  institutionname: 'institutionName',
  'institution name': 'institutionName',
  'instituition name': 'institutionName',
  instituitionname: 'institutionName',
  salutation: 'salutation',
  title: 'salutation',
  send_whatsapp: 'sendWhatsApp',
  sendwhatsapp: 'sendWhatsApp',
  'send whatsapp': 'sendWhatsApp',
  send_email: 'sendEmail',
  sendemail: 'sendEmail',
  'send email': 'sendEmail',
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-\s]+/g, '_').trim();
}

export function parseExcelBuffer(buffer: Buffer): UploadRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('No sheets found in workbook');

  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error('Empty sheet');

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  return raw.map((row) => {
    const mapped: UploadRow = {};
    for (const [rawKey, value] of Object.entries(row)) {
      const normalized = normalizeKey(rawKey);
      const alias = COLUMN_ALIASES[normalized] ?? COLUMN_ALIASES[rawKey.toLowerCase()];
      if (alias) {
        if (alias === 'sendWhatsApp' || alias === 'sendEmail') {
          (mapped as Record<string, unknown>)[alias] =
            value === true || value === 1 || value === 'true' || value === 'yes' || value === 'YES';
        } else {
          (mapped as Record<string, unknown>)[alias] = String(value).trim();
        }
      }
    }
    return mapped;
  });
}

export async function processUpload(
  buffer: Buffer,
  fileName: string,
  channel?: 'whatsapp' | 'email' | 'both',
  teacherChannels?: ('whatsapp' | 'email' | 'both')[],
  mergeDecisions?: MergeDecisionPayload[],
  skippedRowIndices?: number[]
): Promise<{ batchId: string; rowCount: number }> {
  const allRows = parseExcelBuffer(buffer);
  if (allRows.length === 0) throw new Error('No data rows found in file');

  // Filter out rows skipped by admin during in-sheet duplicate review
  const skippedSet = new Set(skippedRowIndices ?? []);
  const rows = skippedSet.size > 0
    ? allRows.filter((_, idx) => !skippedSet.has(idx))
    : allRows;

  if (rows.length === 0) throw new Error('All rows were skipped — no data to upload');

  const batch = await BatchService.create(fileName);

  // Build a lookup from rowIndex → merge decision
  // Note: rowIndices in mergeDecisions refer to original file indices (pre-skip)
  // But teacherChannels are aligned to original indices too
  // We need to map original idx → compressed idx for the active rows
  const originalToActive = new Map<number, number>();
  let activeIdx = 0;
  for (let i = 0; i < allRows.length; i++) {
    if (!skippedSet.has(i)) {
      originalToActive.set(i, activeIdx++);
    }
  }

  const decisionMap = new Map<number, MergeDecisionPayload>();
  if (mergeDecisions) {
    for (const d of mergeDecisions) {
      // mergeDecisions use original rowIndex — remap to active index
      const activeI = originalToActive.get(d.rowIndex);
      if (activeI !== undefined) {
        decisionMap.set(activeI, { ...d, rowIndex: activeI });
      }
    }
  }

  // Remap teacherChannels (originally aligned to all rows) to active rows only
  type Channel = 'whatsapp' | 'email' | 'both';
  const activeTeacherChannels: Channel[] | undefined = teacherChannels
    ? Array.from(originalToActive.entries())
        .sort((a, b) => a[1] - b[1])
        .map(([origIdx]) => (teacherChannels[origIdx] ?? 'both') as Channel)
    : undefined;

  // For "create_new" rows: find which phones/emails already belong to another teacher in DB
  // so we can blank them out (avoid duplicate contact info across teachers)
  const createNewIndices = new Set<number>();
  for (const [idx, d] of decisionMap.entries()) {
    if (d.action === 'create_new') createNewIndices.add(idx);
  }

  const takenPhones = new Set<string>();
  const takenEmails = new Set<string>();

  if (createNewIndices.size > 0) {
    const createNewPhones = rows
      .filter((_, i) => createNewIndices.has(i))
      .map((r) => r.phone?.trim())
      .filter(Boolean) as string[];
    const createNewEmails = rows
      .filter((_, i) => createNewIndices.has(i))
      .map((r) => r.email?.trim())
      .filter(Boolean) as string[];

    if (createNewPhones.length > 0) {
      const existing = await db.select({ phone: phoneLookup.phone })
        .from(phoneLookup)
        .where(inArray(phoneLookup.phone, createNewPhones));
      for (const r of existing) takenPhones.add(r.phone);
    }
    if (createNewEmails.length > 0) {
      const existing = await db.select({ email: emailLookup.email })
        .from(emailLookup)
        .where(inArray(emailLookup.email, createNewEmails));
      for (const r of existing) takenEmails.add(r.email);
    }
  }

  // Track raw record IDs for "merge with new email" — these go to mergedUsers in LMS
  const mergeWithEmailRawIds = new Set<string>();

  // Build raw records without a batchId yet — assigned after batch splitting below
  const rawRecords = rows.map((row, idx) => {
    const effectiveChannel = activeTeacherChannels?.[idx] ?? channel;
    let sendWhatsApp: boolean;
    let sendEmail: boolean;

    if (effectiveChannel === 'whatsapp') {
      sendWhatsApp = true;
      sendEmail = false;
    } else if (effectiveChannel === 'email') {
      sendWhatsApp = false;
      sendEmail = true;
    } else if (effectiveChannel === 'both') {
      sendWhatsApp = true;
      sendEmail = true;
    } else {
      sendWhatsApp = row.sendWhatsApp ?? true;
      sendEmail = row.sendEmail ?? false;
    }

    const decision = decisionMap.get(idx);
    const isMerge = decision?.action === 'merge';
    const isCreateNew = decision?.action === 'create_new';

    const phone = isCreateNew
      ? (takenPhones.has(row.phone?.trim() ?? '') ? undefined : row.phone)
      : row.phone;
    const email = isCreateNew
      ? (takenEmails.has(row.email?.trim() ?? '') ? undefined : row.email)
      : row.email;

    const id = `tr_${nanoid(12)}`;

    // Flag merges that include new email data → will create possibleDuplicates → goes to mergedUsers in LMS
    if (isMerge) {
      const mergeDecision = decision as Extract<MergeDecisionPayload, { action: 'merge' }>;
      if (!mergeDecision.noChanges && mergeDecision.emailsToAdd.length > 0) {
        mergeWithEmailRawIds.add(id);
      }
    }

    return {
      id,
      batchId: '',        // filled in per-chunk below
      name: row.name ?? '',
      phone,
      email,
      school: row.school || row.institutionName || '',
      city: row.city,
      books: row.books ?? row.booksAssigned,
      recordId: row.recordId,
      booksAssigned: row.booksAssigned,
      teacherOwnerId: row.teacherOwnerId,
      teacherOwner: row.teacherOwner,
      firstName: row.firstName,
      lastName: row.lastName,
      institutionId: row.institutionId,
      institutionName: row.institutionName,
      salutation: row.salutation,
      sendWhatsApp,
      sendEmail,
      resolutionStatus: isMerge ? ('RESOLVED' as const) : ('PENDING' as const),
      teacherMasterId: isMerge ? (decision as Extract<MergeDecisionPayload, { action: 'merge' }>).teacherId : undefined,
      isNewTeacher: isCreateNew ? true : undefined,
    };
  }).filter((r) => {
    // Drop no-contact rows — no phone AND no email means we can't message or identify them
    const hasPhone = r.phone && r.phone.trim().length > 0;
    const hasEmail = r.email && r.email.trim().length > 0;
    return hasPhone || hasEmail;
  });

  // ── Split into chained batches of 200 ────────────────────────────────────
  const BATCH_SIZE = 200;
  const chunks: (typeof rawRecords)[] = [];
  for (let i = 0; i < rawRecords.length; i += BATCH_SIZE) {
    chunks.push(rawRecords.slice(i, i + BATCH_SIZE));
  }

  // Create all batch records (first one already created above as `batch`)
  const batchIds: string[] = [batch.id];
  for (let i = 1; i < chunks.length; i++) {
    const b = await BatchService.create(fileName);
    batchIds.push(b.id);
  }

  // Link each batch to the next
  for (let i = 0; i < batchIds.length - 1; i++) {
    await db.update(batches).set({ nextBatchId: batchIds[i + 1] }).where(eq(batches.id, batchIds[i]));
  }

  // Tag all batches in the chain with the same triggerId (first batch's ID)
  await db.update(batches).set({ triggerId: batchIds[0] }).where(inArray(batches.id, batchIds));

  // Insert teachers into each batch
  const resolvedCount = mergeDecisions?.filter((d) => d.action === 'merge').length ?? 0;
  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx].map((r) => ({ ...r, batchId: batchIds[chunkIdx] }));
    for (let i = 0; i < chunk.length; i += 500) {
      await db.insert(teachersRaw).values(chunk.slice(i, i + 500));
    }

    // Insert possibleDuplicates rows for "Merge" records (with new email) so LinkService sends them as mergedUsers
    const mergedInChunk = chunk.filter((r) => r.resolutionStatus === 'RESOLVED' && r.teacherMasterId && mergeWithEmailRawIds.has(r.id));
    if (mergedInChunk.length > 0) {
      await db.insert(possibleDuplicates).values(
        mergedInChunk.map((r) => ({
          id: nanoid(),
          batchId: batchIds[chunkIdx],
          rawTeacherId: r.id,
          candidateTeacherId: r.teacherMasterId!,
          confidenceScore: 0.95,
          matchReasons: ['Phone match'],
          resolution: 'MERGED' as const,
          resolvedAt: new Date(),
        }))
      ).onConflictDoNothing();
    }

    await BatchService.updateStats(batchIds[chunkIdx], { totalTeachers: chunk.length });
    await BatchService.addLog(
      batchIds[chunkIdx],
      'upload',
      `Batch ${chunkIdx + 1}/${chunks.length}: ${chunk.length} teachers from ${fileName}${resolvedCount > 0 && chunkIdx === 0 ? ` (${resolvedCount} pre-resolved merges)` : ''}`,
      chunkIdx > 0 ? `Queued — starts after batch ${chunkIdx} completes` : 'Starting now'
    );
  }

  // Apply teacher master updates for approved merges (not batch-specific)
  const mergeUpdates = mergeDecisions?.filter(
    (d): d is Extract<MergeDecisionPayload, { action: 'merge' }> =>
      d.action === 'merge' && !d.noChanges
  ) ?? [];

  if (mergeUpdates.length > 0) {
    const teacherIds = [...new Set(mergeUpdates.map((d) => d.teacherId))];
    const existingTeachers = await db.query.teachers.findMany({
      where: inArray(teachers.id, teacherIds),
    });
    const teacherMap = new Map(existingTeachers.map((t) => [t.id, t]));
    const teacherUpdatePromises: Promise<unknown>[] = [];

    const newLookupPhones: { phone: string; teacherId: string }[] = [];
    const newLookupEmails: { email: string; teacherId: string }[] = [];

    for (const decision of mergeUpdates) {
      const existing = teacherMap.get(decision.teacherId);
      if (!existing) continue;
      const updatePayload: Partial<typeof teachers.$inferInsert> = { updatedAt: new Date() };
      if (decision.nameChoice === 'file' && decision.newName) {
        updatePayload.name = decision.newName;
      }
      if (decision.phonesToAdd.length > 0) {
        const merged = [...new Set([...existing.phones, ...decision.phonesToAdd])];
        updatePayload.phones = merged;
        for (const p of decision.phonesToAdd) newLookupPhones.push({ phone: p, teacherId: decision.teacherId });
      }
      if (decision.emailsToAdd.length > 0) {
        const merged = [...new Set([...existing.emails, ...decision.emailsToAdd])];
        updatePayload.emails = merged;
        for (const e of decision.emailsToAdd) newLookupEmails.push({ email: e, teacherId: decision.teacherId });
      }
      teacherUpdatePromises.push(
        db.update(teachers).set(updatePayload).where(eq(teachers.id, decision.teacherId))
      );
    }
    if (teacherUpdatePromises.length > 0) await Promise.all(teacherUpdatePromises);

    if (newLookupPhones.length > 0) {
      await db.insert(phoneLookup).values(newLookupPhones).onConflictDoNothing();
    }
    if (newLookupEmails.length > 0) {
      await db.insert(emailLookup).values(newLookupEmails).onConflictDoNothing();
    }
  }

  // Only kick off the first batch — subsequent ones start via chain
  await BatchService.advance(batchIds[0], 'auto_upload_complete');

  return { batchId: batchIds[0], rowCount: rows.length };
}

// ─── Reviewed rows (JSON) ──────────────────────────────────────────────────

type ChannelChoice = 'both' | 'whatsapp' | 'email' | 'none';

export type ReviewedRow = UploadRow & {
  phoneSelected?: string;
  emailSelected?: string;
  channels: ChannelChoice;
  existingTeacherId?: string;
};

/**
 * Process pre-reviewed rows from the frontend (no file needed).
 * Splits into sequential batches of BATCH_SIZE; only the first batch starts
 * immediately — each subsequent batch auto-starts when its predecessor completes.
 */
export async function processReviewedRows(
  rows: ReviewedRow[],
  fileName?: string
): Promise<{ batchId: string; rowCount: number; batchCount: number }> {
  if (rows.length === 0) throw new Error('No rows to process');

  const BATCH_SIZE = 200;
  const chunks: ReviewedRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    chunks.push(rows.slice(i, i + BATCH_SIZE));
  }

  // Create all batch records upfront
  const batchIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const batch = await BatchService.create(fileName ?? 'reviewed-upload');
    batchIds.push(batch.id);
  }

  // Link each batch to the next via nextBatchId
  for (let i = 0; i < batchIds.length - 1; i++) {
    await db
      .update(batches)
      .set({ nextBatchId: batchIds[i + 1] })
      .where(eq(batches.id, batchIds[i]));
  }

  // Tag all batches in the chain with the same triggerId (first batch's ID)
  await db.update(batches).set({ triggerId: batchIds[0] }).where(inArray(batches.id, batchIds));

  // Insert teachers into each batch
  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const batchId = batchIds[chunkIdx];

    const rawRecords = chunk.map((row) => {
      let sendWhatsApp = true;
      let sendEmail = false;
      if (row.channels === 'whatsapp') { sendWhatsApp = true; sendEmail = false; }
      else if (row.channels === 'email') { sendWhatsApp = false; sendEmail = true; }
      else if (row.channels === 'both') { sendWhatsApp = true; sendEmail = true; }
      else if (row.channels === 'none') { sendWhatsApp = false; sendEmail = false; }

      return {
        id: `tr_${nanoid(12)}`,
        batchId,
        name: row.name ?? '',
        phone: row.phoneSelected ?? row.phone,
        email: row.emailSelected ?? row.email,
        school: row.school || row.institutionName || '',
        city: row.city,
        books: row.books ?? row.booksAssigned,
        recordId: row.recordId,
        booksAssigned: row.booksAssigned,
        teacherOwnerId: row.teacherOwnerId,
        teacherOwner: row.teacherOwner,
        firstName: row.firstName,
        lastName: row.lastName,
        institutionId: row.institutionId,
        institutionName: row.institutionName,
        salutation: row.salutation,
        sendWhatsApp,
        sendEmail,
        resolutionStatus: row.existingTeacherId ? ('RESOLVED' as const) : ('PENDING' as const),
        teacherMasterId: row.existingTeacherId,
      };
    });

    // Drop no-contact rows before saving
    const contactableRecords = rawRecords.filter((r) => {
      const hasPhone = r.phone && r.phone.trim().length > 0;
      const hasEmail = r.email && r.email.trim().length > 0;
      return hasPhone || hasEmail;
    });

    for (let i = 0; i < contactableRecords.length; i += 500) {
      await db.insert(teachersRaw).values(contactableRecords.slice(i, i + 500));
    }

    await BatchService.updateStats(batchId, { totalTeachers: contactableRecords.length });
    await BatchService.addLog(
      batchId,
      'upload',
      `Batch ${chunkIdx + 1}/${chunks.length}: ${chunk.length} teachers loaded`,
      chunkIdx > 0 ? `Queued — will start after batch ${chunkIdx} completes` : 'Starting now'
    );
  }

  // Only kick off the first batch; subsequent batches start via BatchService chain
  await BatchService.advance(batchIds[0], 'auto_upload_complete');

  return { batchId: batchIds[0], rowCount: rows.length, batchCount: chunks.length };
}
