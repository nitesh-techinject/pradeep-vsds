import {
  pgTable,
  pgEnum,
  text,
  boolean,
  integer,
  serial,
  real,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const batchStatusEnum = pgEnum('batch_status', [
  'UPLOADED',
  'VALIDATING',
  'RESOLVING',
  'ORDERING',
  'MESSAGING',
  'COMPLETE',
  'PARTIAL_FAILURE',
  'PAUSED',
  'CANCELLED',
  'FAILED',
]);

export const resolutionStatusEnum = pgEnum('resolution_status', [
  'PENDING',
  'RESOLVED',
  'FAILED',
]);

export const channelEnum = pgEnum('channel', ['WHATSAPP', 'EMAIL']);

export const commLogStatusEnum = pgEnum('comm_log_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'DLQ',
  'CANCELLED',
  'SKIPPED',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'SENT',
  'DELIVERED',
  'READ',
  'OPENED',
  'CLICKED',
  'BOUNCED',
  'COMPLAINED',
  'DELAYED',
  'FAILED',
  'UNDELIVERABLE',
]);

export const dlqStatusEnum = pgEnum('dlq_status', ['FAILED', 'RETRYING', 'RESOLVED']);

export const dlqErrorTypeEnum = pgEnum('dlq_error_type', [
  'RATE_LIMIT',
  'INVALID_PHONE',
  'INVALID_EMAIL',
  'API_DOWN',
  'TIMEOUT',
  'TEMPLATE_ERROR',
  'UNKNOWN',
]);

export const duplicateResolutionEnum = pgEnum('duplicate_resolution', [
  'PENDING',
  'MERGED',
  'KEPT_SEPARATE',
]);

export const batchErrorStageEnum = pgEnum('batch_error_stage', [
  'RESOLUTION',
  'ORDERS',
  'AGGREGATION',
  'MESSAGES',
]);

export const batchLogStepEnum = pgEnum('batch_log_step', [
  'upload',
  'validation',
  'resolution',
  'resolution_teacher',
  'ordering',
  'ordering_order_created',
  'aggregation',
  'aggregation_complete',
  'outbox_queued',
  'message_sent',
  'message_delivered',
  'message_failed',
  'batch_advanced',
  'batch_paused',
  'batch_resumed',
  'batch_cancelled',
  'error',
  'lms_api',
  'firebase_api',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Type helpers
// ─────────────────────────────────────────────────────────────────────────────

export type BatchStats = {
  totalTeachers?: number;
  teachersResolved?: number;
  resolutionErrors?: number;
  ordersCreated?: number;
  expectedOrders?: number;
  messagesQueued?: number;
  messagesDelivered?: number;
  messagesFailed?: number;
  messagesProcessed?: number;
  dlqMessages?: number;
};

export type StatusHistoryEntry = {
  from: string;
  to: string;
  trigger: string;
  timestamp: string;
};

export type BookLink = {
  productId: string;
  title: string;
  author?: string;
  coverUrl?: string;
  specimenUrl: string;
  expiresAt: string;
};

export type AggregationLink = {
  orderId: string;
  title: string;
  productId: string;
  url: string;
  expiresAt: string;
};

export type TeacherRecord = {
  name?: string;
  firstName?: string;
  lastName?: string;
  salutation?: string;
  phone?: string;
  email?: string;
  school?: string;
  city?: string;
  recordId?: string;
  booksAssigned?: string;
  teacherOwnerId?: string;
  teacherOwner?: string;
  institutionId?: string;
  institutionName?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

/** Main batch lifecycle tracker */
export const batches = pgTable(
  'batches',
  {
    id: text('id').primaryKey(),
    seqId: serial('seq_id').notNull().unique(),
    status: batchStatusEnum('status').notNull().default('UPLOADED'),
    fileName: text('file_name'),
    stats: jsonb('stats').$type<BatchStats>().default({}),
    statusHistory: jsonb('status_history').$type<StatusHistoryEntry[]>().default([]),
    pausedFromStage: text('paused_from_stage'),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    triggerId: text('trigger_id'),
    nextBatchId: text('next_batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index('batches_status_idx').on(t.status),
    createdIdx: index('batches_created_idx').on(t.createdAt),
  }),
);

/** Deduplicated master teacher records */
export const teachers = pgTable(
  'teachers',
  {
    id: text('id').primaryKey(),
    seqId: serial('seq_id').notNull().unique(),
    name: text('name').notNull(),
    phones: jsonb('phones').$type<string[]>().default([]).notNull(),
    emails: jsonb('emails').$type<string[]>().default([]).notNull(),
    school: text('school'),
    city: text('city'),
    recordId: text('record_id'),
    booksAssigned: text('books_assigned'),
    teacherOwnerId: text('teacher_owner_id'),
    teacherOwner: text('teacher_owner'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    institutionId: text('institution_id'),
    institutionName: text('institution_name'),
    salutation: text('salutation'),
    firebaseId: text('firebase_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameIdx: index('teachers_name_idx').on(t.name),
  }),
);

/** Normalized phone → teacher lookup index */
export const phoneLookup = pgTable(
  'phone_lookup',
  {
    phone: text('phone').primaryKey(), // E.164 normalized
    teacherId: text('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    teacherIdx: index('phone_lookup_teacher_idx').on(t.teacherId),
  }),
);

/** Normalized email → teacher lookup index */
export const emailLookup = pgTable(
  'email_lookup',
  {
    email: text('email').primaryKey(), // lowercase normalized
    teacherId: text('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    teacherIdx: index('email_lookup_teacher_idx').on(t.teacherId),
  }),
);

/** Raw teacher records from uploaded batches (pre-resolution) */
export const teachersRaw = pgTable(
  'teachers_raw',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    name: text('name'),
    phone: text('phone'),
    email: text('email'),
    school: text('school'),
    city: text('city'),
    books: text('books'), // comma-separated
    resolutionStatus: resolutionStatusEnum('resolution_status').notNull().default('PENDING'),
    teacherMasterId: text('teacher_master_id').references(() => teachers.id),
    isNewTeacher: boolean('is_new_teacher'),
    resolutionConfidence: real('resolution_confidence'),
    resolutionError: text('resolution_error'),
    sendWhatsApp: boolean('send_whatsapp').default(true),
    sendEmail: boolean('send_email').default(false),
    // Extended fields from upload template
    recordId: text('record_id'),
    booksAssigned: text('books_assigned'),
    teacherOwnerId: text('teacher_owner_id'),
    teacherOwner: text('teacher_owner'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    institutionId: text('institution_id'),
    institutionName: text('institution_name'),
    salutation: text('salutation'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('teachers_raw_batch_idx').on(t.batchId),
    statusIdx: index('teachers_raw_status_idx').on(t.resolutionStatus),
    masterIdx: index('teachers_raw_master_idx').on(t.teacherMasterId),
  }),
);

/** Specimen orders (denormalized for downstream messaging) */
export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(), // deterministic: `${teacherRecordId}_${batchId}`
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    teacherRecordId: text('teacher_record_id')
      .notNull()
      .references(() => teachersRaw.id),
    teacherMasterId: text('teacher_master_id').references(() => teachers.id),
    teacherName: text('teacher_name').notNull(),
    teacherPhone: text('teacher_phone'),
    teacherEmail: text('teacher_email'),
    school: text('school'),
    city: text('city'),
    books: jsonb('books').$type<BookLink[]>().default([]),
    totalBooks: integer('total_books').default(0),
    sendWhatsApp: boolean('send_whatsapp').default(true),
    sendEmail: boolean('send_email').default(false),
    status: text('status').default('created'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('orders_batch_idx').on(t.batchId),
    teacherIdx: index('orders_teacher_idx').on(t.teacherMasterId),
  }),
);

/**
 * Aggregation tracker — one row per teacher×batch.
 */
export const aggregations = pgTable(
  'aggregations',
  {
    id: text('id').primaryKey(), // `${teacherMasterId}_${batchId}`
    teacherMasterId: text('teacher_master_id')
      .notNull()
      .references(() => teachers.id),
    teacherRecordId: text('teacher_record_id').references(() => teachersRaw.id),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    teacherName: text('teacher_name'),
    teacherPhone: text('teacher_phone'),
    teacherEmail: text('teacher_email'),
    books: text('books'),
    sendWhatsApp: boolean('send_whatsapp').default(true),
    sendEmail: boolean('send_email').default(false),
    expectedLinkCount: integer('expected_link_count').notNull().default(0),
    linkCount: integer('link_count').notNull().default(0),
    links: jsonb('links').$type<AggregationLink[]>().default([]),
    isComplete: boolean('is_complete').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('aggregations_batch_idx').on(t.batchId),
    completeIdx: index('aggregations_complete_idx').on(t.isComplete),
  }),
);

/**
 * Communication log — one row per (teacher×batch×channel).
 * SHA256 hash of (contact:batchId:channel) as PK for idempotency.
 */
export const commLog = pgTable(
  'comm_log',
  {
    id: text('id').primaryKey(), // SHA256 message hash
    messageHash: text('message_hash').notNull().unique(),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    teacherMasterId: text('teacher_master_id'),
    teacherRecordId: text('teacher_record_id'),
    aggregationKey: text('aggregation_key'),
    channel: channelEnum('channel').notNull(),
    teacherPhone: text('teacher_phone'),
    teacherEmail: text('teacher_email'),
    teacherName: text('teacher_name'),
    books: text('books'),
    status: commLogStatusEnum('status').notNull().default('QUEUED'),
    attemptCount: integer('attempt_count').notNull().default(0),
    externalMessageId: text('external_message_id'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    skipReason: text('skip_reason'),
    errorType: text('error_type'),
    retriedAt: timestamp('retried_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('comm_log_batch_idx').on(t.batchId),
    teacherIdx: index('comm_log_teacher_idx').on(t.teacherMasterId),
    statusIdx: index('comm_log_status_idx').on(t.status),
    externalIdx: index('comm_log_external_idx').on(t.externalMessageId),
  }),
);

/** Audit log of every message send attempt */
export const messageSendLog = pgTable(
  'message_send_log',
  {
    id: text('id').primaryKey(),
    commLogId: text('comm_log_id').references(() => commLog.id),
    batchId: text('batch_id').references(() => batches.id),
    teacherMasterId: text('teacher_master_id'),
    teacherPhone: text('teacher_phone'),
    teacherEmail: text('teacher_email'),
    teacherName: text('teacher_name'),
    channel: channelEnum('channel').notNull(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
    status: text('status').notNull(), // sent | delivered | failed
    externalMessageId: text('external_message_id'),
    error: text('error'),
    linkCount: integer('link_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    phoneIdx: index('msg_send_log_phone_idx').on(t.teacherPhone),
    emailIdx: index('msg_send_log_email_idx').on(t.teacherEmail),
    batchIdx: index('msg_send_log_batch_idx').on(t.batchId),
    sentIdx: index('msg_send_log_sent_idx').on(t.sentAt),
  }),
);

/** Delivery status updates from WATI / Resend webhooks */
export const teacherCommunications = pgTable(
  'teacher_communications',
  {
    id: text('id').primaryKey(),
    commLogId: text('comm_log_id').references(() => commLog.id),
    teacherId: text('teacher_id').references(() => teachers.id),
    batchId: text('batch_id').references(() => batches.id),
    channel: channelEnum('channel').notNull(),
    externalMessageId: text('external_message_id'),
    deliveryStatus: deliveryStatusEnum('delivery_status').notNull(),
    deliveryError: text('delivery_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    externalIdx: index('teacher_comm_external_idx').on(t.externalMessageId),
  }),
);

/** Dead Letter Queue — messages that exhausted retries */
export const failedMessages = pgTable(
  'failed_messages',
  {
    id: text('id').primaryKey(),
    commLogId: text('comm_log_id').references(() => commLog.id),
    batchId: text('batch_id').references(() => batches.id),
    teacherMasterId: text('teacher_master_id'),
    teacherRecordId: text('teacher_record_id'),
    channel: channelEnum('channel').notNull(),
    teacherPhone: text('teacher_phone'),
    teacherEmail: text('teacher_email'),
    errorType: dlqErrorTypeEnum('error_type').notNull(),
    errorMessage: text('error_message').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    isRetryable: boolean('is_retryable').notNull().default(true),
    status: dlqStatusEnum('status').notNull().default('FAILED'),
    retriedAt: timestamp('retried_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('failed_msg_batch_idx').on(t.batchId),
    retryableIdx: index('failed_msg_retryable_idx').on(t.isRetryable),
    statusIdx: index('failed_msg_status_idx').on(t.status),
  }),
);

/** Flagged duplicate teachers for manual review */
export const possibleDuplicates = pgTable(
  'possible_duplicates',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').references(() => batches.id),
    rawTeacherId: text('raw_teacher_id').references(() => teachersRaw.id),
    candidateTeacherId: text('candidate_teacher_id').references(() => teachers.id),
    confidenceScore: real('confidence_score').notNull(),
    matchReasons: jsonb('match_reasons').$type<string[]>().default([]),
    resolution: duplicateResolutionEnum('resolution').notNull().default('PENDING'),
    reviewedBy: text('reviewed_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    incomingRecord: jsonb('incoming_record').$type<TeacherRecord>(),
    existingRecord: jsonb('existing_record').$type<TeacherRecord>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('dup_batch_idx').on(t.batchId),
    resolutionIdx: index('dup_resolution_idx').on(t.resolution),
  }),
);

/** Errors during batch processing stages */
export const batchErrors = pgTable(
  'batch_errors',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    stage: batchErrorStageEnum('stage').notNull(),
    commLogId: text('comm_log_id'),
    teacherRawId: text('teacher_raw_id'),
    errorType: text('error_type').notNull(),
    errorMessage: text('error_message').notNull(),
    isRetryable: boolean('is_retryable').notNull().default(true),
    teacherName: text('teacher_name'),
    teacherPhone: text('teacher_phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('batch_err_batch_idx').on(t.batchId),
    stageIdx: index('batch_err_stage_idx').on(t.stage),
    retryableIdx: index('batch_err_retryable_idx').on(t.isRetryable),
  }),
);

/** Batch processing audit trail */
export const batchLogs = pgTable(
  'batch_logs',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    step: batchLogStepEnum('step').notNull(),
    message: text('message').notNull(),
    detail: text('detail'),
    teacherName: text('teacher_name'),
    teacherPhone: text('teacher_phone'),
    teacherEmail: text('teacher_email'),
    channel: channelEnum('channel'),
    metadata: jsonb('metadata'),
    loggedAt: timestamp('logged_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('batch_logs_batch_idx').on(t.batchId),
    stepIdx: index('batch_logs_step_idx').on(t.step),
  }),
);

/**
 * Every external API call — WATI, Resend, LMS, Firebase.
 * Captures request body, response body, status code, and latency for debugging.
 */
export const apiCallLogs = pgTable(
  'api_call_logs',
  {
    id: text('id').primaryKey(),
    service: text('service').notNull(),              // 'wati' | 'resend' | 'lms' | 'firebase'
    endpoint: text('endpoint').notNull(),
    method: text('method').notNull().default('POST'),
    requestBody: jsonb('request_body'),
    responseBody: jsonb('response_body'),
    statusCode: integer('status_code'),
    errorMessage: text('error_message'),
    latencyMs: integer('latency_ms'),
    batchId: text('batch_id').references(() => batches.id),
    commLogId: text('comm_log_id').references(() => commLog.id),
    teacherPhone: text('teacher_phone'),
    teacherEmail: text('teacher_email'),
    teacherName: text('teacher_name'),
    requestCount: integer('request_count').default(1), // for bulk: how many items in the batch call
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    batchIdx: index('api_call_logs_batch_idx').on(t.batchId),
    serviceIdx: index('api_call_logs_service_idx').on(t.service),
    createdIdx: index('api_call_logs_created_idx').on(t.createdAt),
  }),
);

/** Saved batch specimen links */
export const batchLinks = pgTable('batch_links', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .unique()
    .references(() => batches.id),
  links: jsonb('links'), // teacherRecordId → productId → url
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Book code → Algolia product mappings */
export const bookMappings = pgTable(
  'book_mappings',
  {
    id: text('id').primaryKey(),
    bookCode: text('book_code').notNull(),
    productId: text('product_id').notNull(),
    productTitle: text('product_title').notNull(),
    authors: jsonb('authors').$type<Array<{id: string; title: string}>>().default([]),
    notes: text('notes'),
    coverUrl: text('cover_url'),
    edition: text('edition'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bookCodeIdx: index('book_mappings_book_code_idx').on(t.bookCode),
    productIdx: index('book_mappings_product_id_idx').on(t.productId),
    bookCodeProductUniq: uniqueIndex('book_mappings_code_product_uniq').on(t.bookCode, t.productId),
  }),
);

/** WATI template definitions + variable → data-path mappings */
export type WatiTemplateParam = {
  paramName: string;   // WATI parameter name, e.g. "name", "bookname1"
  dataPath: string;    // dot-path into resolved context, e.g. "teacher.name", "books.0.title"
  fallback: string;    // value used when the path resolves to empty
};

export const watiTemplates = pgTable(
  'wati_templates',
  {
    id: text('id').primaryKey(),
    templateName: text('template_name').notNull().unique(), // exact name in WATI, e.g. "spemst_4"
    displayName: text('display_name').notNull(),
    bodyPreview: text('body_preview'),                       // paste of the raw template text
    params: jsonb('params').$type<WatiTemplateParam[]>().default([]),
    isActive: boolean('is_active').notNull().default(false), // fallback template when no bookCount match
    bookCount: integer('book_count'),                        // null = fallback; N = use for orders with N books
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

/** Algolia products cached locally */
export const algoliaProducts = pgTable(
  'algolia_products',
  {
    objectID: text('object_id').primaryKey(),
    title: text('title').notNull(),
    isbn: text('isbn'),
    subject: text('subject'),
    grade: text('grade'),
    publisher: text('publisher'),
    coverUrl: text('cover_url'),
    rawData: jsonb('raw_data'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    titleIdx: index('algolia_products_title_idx').on(t.title),
    isbnIdx: index('algolia_products_isbn_idx').on(t.isbn),
  }),
);
