import type {
  Batch,
  BatchDetail,
  BatchError,
  BatchErrorParams,
  BatchListParams,
  BatchLogEntry,
  DLQEntry,
  DLQListParams,
  DashboardStats,
  DuplicateListParams,
  DuplicateRecord,
  GenerateLinksRequest,
  GenerateLinksResponse,
  MessageLogsResponse,
  PaginatedResponse,
  ReviewedRow,
  Teacher,
  TeacherListParams,
  UploadedTeacher,
} from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 30_000;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 404) throw new Error(`Not found: ${body}`);
      if (res.status === 409) throw new Error(`Conflict: ${body}`);
      if (res.status === 400) throw new Error(`Bad request: ${body}`);
      throw new Error(`API Error ${res.status}: ${body}`);
    }

    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out — please try again");
    }
    throw err;
  }
}

function toQueryString(params: object): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

// ---- Dashboard ----

export async function getDashboardStats(): Promise<DashboardStats> {
  return request<DashboardStats>("/dashboard/stats");
}

// ---- Upload ----

export type MergeDecisionPayload =
  | { rowIndex: number; action: "merge"; teacherId: string; nameChoice: "file" | "db"; noChanges: boolean; phonesToAdd: string[]; emailsToAdd: string[]; newName?: string }
  | { rowIndex: number; action: "create_new" };

export async function uploadSpecimen(
  file: File,
  channel?: "whatsapp" | "email" | "both",
  teacherChannels?: ("whatsapp" | "email" | "both")[],
  mergeDecisions?: MergeDecisionPayload[],
  skippedRowIndices?: number[]
): Promise<{ batchId: string; rowCount: number }> {
  const formData = new FormData();
  formData.append("file", file);
  if (channel) {
    formData.append("channel", channel);
  }
  if (teacherChannels && teacherChannels.length > 0) {
    formData.append("teacherChannels", JSON.stringify(teacherChannels));
  }
  if (mergeDecisions && mergeDecisions.length > 0) {
    formData.append("mergeDecisions", JSON.stringify(mergeDecisions));
  }
  if (skippedRowIndices && skippedRowIndices.length > 0) {
    formData.append("skippedRowIndices", JSON.stringify(skippedRowIndices));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${API_BASE_URL}/upload`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Upload failed ${res.status}: ${body}`);
    }

    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Upload timed out — file may be too large");
    }
    throw err;
  }
}

export async function uploadSpecimenReviewed(
  rows: ReviewedRow[]
): Promise<{ batchId: string; teacherCount: number; teachers: UploadedTeacher[] }> {
  return request<{ batchId: string; teacherCount: number; teachers: UploadedTeacher[] }>(`/upload/reviewed`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}

export async function createOrders(batchId: string): Promise<{ batchId: string }> {
  return request<{ batchId: string }>(`/batches/${batchId}/advance`, {
    method: "POST",
  });
}

export async function generateLinks(
  payload: GenerateLinksRequest
): Promise<GenerateLinksResponse> {
  return request<GenerateLinksResponse>(`/batches/${payload.batchId}/links`, {
    method: "POST",
  });
}

export async function getBatchLinks(batchId: string): Promise<{
  id: string;
  batchId: string;
  links: Record<string, Record<string, string>>; // teacherRecordId → productId → url
  expiresAt: string;
}> {
  return request(`/batches/${batchId}/links`);
}

// ---- Batches ----

export async function listBatches(params: BatchListParams = {}): Promise<PaginatedResponse<Batch>> {
  return request<PaginatedResponse<Batch>>(`/batches${toQueryString(params)}`);
}

export async function getBatch(batchId: string): Promise<BatchDetail> {
  return request<BatchDetail>(`/batches/${batchId}`);
}

export interface BatchTeacherOrderItem {
  productId: string;
  title: string;
  link: string;
  expiresAt: string;
  status?: "created" | "pending";
}

export interface BatchTeacherWithOrders {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  school: string | null;
  books: string | null;
  resolutionStatus: string;
}

export async function getBatchTeachers(
  batchId: string,
  params: { page?: number; pageSize?: number; status?: string } = {}
): Promise<PaginatedResponse<BatchTeacherWithOrders>> {
  return request<PaginatedResponse<BatchTeacherWithOrders>>(
    `/batches/${batchId}/teachers${toQueryString(params)}`
  );
}

export async function pauseBatch(batchId: string): Promise<void> {
  await request(`/batches/${batchId}/pause`, { method: "POST" });
}

export async function resumeBatch(batchId: string): Promise<void> {
  await request(`/batches/${batchId}/resume`, { method: "POST" });
}

export async function cancelBatch(batchId: string, reason: string): Promise<void> {
  await request(`/batches/${batchId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function checkAdvanceBatch(batchId: string): Promise<{ batchId: string; status: string }> {
  return request<{ batchId: string; status: string }>(`/batches/${batchId}/advance`, {
    method: "POST",
  });
}

export async function retryResolution(batchId: string): Promise<{ batchId: string; status: string }> {
  return request<{ batchId: string; status: string }>(`/batches/${batchId}/errors/retry`, {
    method: "POST",
    body: JSON.stringify({ stage: "RESOLUTION" }),
  });
}

export async function retryOrderCreation(batchId: string): Promise<{ batchId: string; ordersToCreate: number }> {
  const res = await request<{ retriedCount: number }>(`/batches/${batchId}/errors/retry`, {
    method: "POST",
    body: JSON.stringify({ stage: "ORDERS" }),
  });
  return { batchId, ordersToCreate: res.retriedCount };
}

export async function retryDispatching(batchId: string): Promise<{ batchId: string; totalMessages: number }> {
  const res = await request<{ retriedCount: number; skippedCount: number }>("/dlq/retry", {
    method: "POST",
    body: JSON.stringify({ retryAll: true, batchId }),
  });
  return { batchId, totalMessages: res.retriedCount };
}

export interface BatchOrder {
  id: string;
  batchId: string;
  teacherRecordId: string;
  teacherMasterId: string | null;
  teacherName: string;
  teacherPhone: string | null;
  teacherEmail: string | null;
  school: string | null;
  books: Array<{ productId: string; title: string; specimenUrl: string; expiresAt: string }>;
  totalBooks: number;
  sendWhatsApp: boolean;
  sendEmail: boolean;
  status: string;
  loginLink: string;
  messages: Array<{ channel: string; status: string; lastError: string | null }>;
  createdAt: string;
}

export async function getBatchOrders(
  batchId: string,
  params?: { page?: number; pageSize?: number }
): Promise<PaginatedResponse<BatchOrder>> {
  return request<PaginatedResponse<BatchOrder>>(
    `/batches/${batchId}/orders${toQueryString(params ?? {})}`
  );
}

export async function getBatchLogs(
  batchId: string,
  params?: { step?: string; page?: number; pageSize?: number }
): Promise<PaginatedResponse<BatchLogEntry>> {
  return request<PaginatedResponse<BatchLogEntry>>(
    `/batches/${batchId}/logs${toQueryString(params ?? {})}`
  );
}

// ---- Batch Errors ----

export async function getBatchErrors(
  batchId: string,
  params: BatchErrorParams = {}
): Promise<PaginatedResponse<BatchError>> {
  return request<PaginatedResponse<BatchError>>(`/batches/${batchId}/errors${toQueryString(params)}`);
}

export async function retryBatchErrors(batchId: string, stage?: string): Promise<{ retriedCount: number }> {
  return request<{ retriedCount: number }>(`/batches/${batchId}/errors/retry`, {
    method: "POST",
    body: JSON.stringify({ stage }),
  });
}

// ---- Duplicates ----

export async function listDuplicates(params: DuplicateListParams = {}): Promise<PaginatedResponse<DuplicateRecord>> {
  return request<PaginatedResponse<DuplicateRecord>>(`/duplicates${toQueryString(params)}`);
}

export async function resolveDuplicate(
  duplicateId: string,
  action: "merge" | "keep_separate"
): Promise<void> {
  await request(`/duplicates/${duplicateId}/resolve`, {
    method: "POST",
    body: JSON.stringify({
      resolution: action === "merge" ? "MERGED" : "KEPT_SEPARATE",
    }),
  });
}

// ---- Messages ----

export interface CommLogEntry {
  id: string;
  batchId: string;
  channel: "WHATSAPP" | "EMAIL";
  teacherName?: string;
  teacherPhone?: string;
  teacherEmail?: string;
  books?: string;
  status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | "DLQ" | "CANCELLED" | "SKIPPED";
  attemptCount: number;
  lastError?: string;
  externalMessageId?: string;
  lastAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BatchCommSummary {
  batchId: string;
  fileName: string;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  dlq: number;
  total: number;
}

export interface CommLogsResponse {
  data: CommLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  batchSummary: BatchCommSummary[];
}

export async function listCommLogs(params?: {
  batchId?: string;
  channel?: "WHATSAPP" | "EMAIL";
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<CommLogsResponse> {
  return request<CommLogsResponse>(`/comm-logs${toQueryString(params ?? {})}`);
}

export async function listMessageLogs(params?: {
  batchId?: string;
  teacherPhone?: string;
  teacherEmail?: string;
  channel?: "whatsapp" | "email";
  page?: number;
  pageSize?: number;
}): Promise<MessageLogsResponse> {
  return request<MessageLogsResponse>(
    `/dlq${toQueryString(params ?? {})}`
  );
}

export async function resendMessage(communicationId: string, channel: string): Promise<void> {
  await request(`/dlq/retry`, {
    method: "POST",
    body: JSON.stringify({ ids: [communicationId] }),
  });
}

// ---- DLQ ----

export async function listDLQ(params: DLQListParams = {}): Promise<PaginatedResponse<DLQEntry>> {
  return request<PaginatedResponse<DLQEntry>>(`/dlq${toQueryString(params)}`);
}

export async function retryDLQ(data: {
  ids?: string[];
  retryAll?: boolean;
  batchId?: string;
}): Promise<{ retriedCount: number; skippedCount?: number }> {
  return request<{ retriedCount: number; skippedCount?: number }>("/dlq/retry", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---- Teachers ----

export async function listTeachers(params: TeacherListParams = {}): Promise<PaginatedResponse<Teacher>> {
  return request<PaginatedResponse<Teacher>>(`/teachers${toQueryString(params)}`);
}

export interface ContactConflict {
  field: "phone" | "email";
  ownerId: string;
  ownerName: string;
}

export async function addTeacherContacts(
  teacherId: string,
  data: { phone?: string; email?: string }
): Promise<{ teacher?: Teacher; conflicts?: ContactConflict[] }> {
  try {
    const teacher = await request<Teacher>(`/teachers/${teacherId}/contacts`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return { teacher };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Conflict:")) {
      const body = err.message.replace("Conflict: ", "");
      try {
        const parsed = JSON.parse(body);
        return { conflicts: parsed.conflicts };
      } catch {}
    }
    throw err;
  }
}

export interface TeacherRef {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
  school: string;
  city: string;
}

export interface DBDuplicateMatch {
  rowIndex: number;
  row: { name: string; phone: string; email: string; school: string };
  existingTeacher: TeacherRef;
  /** 0–100 */
  confidence: number;
  matchReasons: string[];
  diff: {
    nameConflict: boolean;
    phonesToAdd: string[];
    emailsToAdd: string[];
    schoolConflict: boolean;
    noChanges: boolean; // 100% match — nothing to update
  };
  // Set when phone and email match DIFFERENT teachers in DB
  isSplitMatch?: boolean;
  phoneMatchTeacher?: TeacherRef;
  emailMatchTeacher?: TeacherRef;
}

export async function checkDuplicatesAgainstDB(
  rows: { name: string; phone: string; email: string; school: string }[]
): Promise<DBDuplicateMatch[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min for large files
  try {
    const res = await fetch(`${API_BASE_URL}/teachers/check-duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Duplicate check failed: ${body}`);
    }
    const data = await res.json() as { matches: DBDuplicateMatch[]; total: number };
    return data.matches;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Duplicate check timed out — file may be too large");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function mergeTeacher(data: {
  teacherId: string;
  name?: string;
  phones: string[];
  emails: string[];
}): Promise<void> {
  await request(`/teachers/${data.teacherId}/merge`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---- Book Mappings ----

export interface BookMapping {
  id: string;
  bookCode: string;
  productId: string;
  productTitle: string;
  authors: Array<{id: string; title: string}>;
  notes: string | null;
  coverUrl: string | null;
  edition: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listBookMappings(params: {
  page?: number;
  pageSize?: number;
  search?: string;
} = {}): Promise<{ data: BookMapping[]; total: number; page: number; pageSize: number }> {
  return request(`/book-mappings${toQueryString(params)}`);
}

export async function lookupBookCodes(codes: string[]): Promise<{ mappings: BookMapping[] }> {
  return request("/book-mappings/lookup", {
    method: "POST",
    body: JSON.stringify({ codes }),
  });
}

export async function createBookMapping(data: {
  bookCode: string;
  productId: string;
  productTitle: string;
  authors?: Array<{id: string; title: string}>;
  notes?: string;
  coverUrl?: string | null;
  edition?: string | null;
}): Promise<BookMapping> {
  const payload = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined));
  return request("/book-mappings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateBookMapping(
  id: string,
  data: { bookCode?: string; productId?: string; productTitle?: string; authors?: Array<{id: string; title: string}>; notes?: string; coverUrl?: string | null; edition?: string | null }
): Promise<BookMapping> {
  return request(`/book-mappings/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteBookMapping(id: string): Promise<void> {
  await request(`/book-mappings/${id}`, { method: "DELETE" });
}

// ---- Algolia ----

export interface AlgoliaProduct {
  objectID: string;
  title: string;
  isbn: string | null;
  subject: string | null;
  grade: string | null;
  publisher: string | null;
  coverUrl: string | null;
  syncedAt: string;
}

export interface AlgoliaHit {
  objectID: string;
  title?: string;
  isbn?: string;
  subject?: string;
  grade?: string;
  publisher?: string;
  edition?: string;
  image?: string;
  "mainImage.url"?: string;
  authors?: Array<{ id: string; title: string }>;
  [key: string]: unknown;
}

export async function searchAlgolia(q: string): Promise<{ hits: AlgoliaHit[] }> {
  return request(`/algolia/search?q=${encodeURIComponent(q)}`);
}

export async function listAlgoliaProducts(params: {
  page?: number;
  pageSize?: number;
  search?: string;
} = {}): Promise<{ data: AlgoliaProduct[]; total: number; page: number; pageSize: number }> {
  return request(`/algolia/products${toQueryString(params)}`);
}

export async function syncAlgoliaProducts(products: Omit<AlgoliaProduct, "syncedAt">[]): Promise<{ synced: number }> {
  return request("/algolia/products/sync", {
    method: "POST",
    body: JSON.stringify({ products }),
  });
}

export async function deleteAlgoliaProduct(objectID: string): Promise<void> {
  await request(`/algolia/products/${encodeURIComponent(objectID)}`, { method: "DELETE" });
}

// ---- WATI Templates ----

export interface WatiTemplateParam {
  paramName: string;
  dataPath: string;
  fallback: string;
}

export interface WatiTemplate {
  id: string;
  templateName: string;
  displayName: string;
  bodyPreview: string | null;
  params: WatiTemplateParam[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listWatiTemplates(): Promise<WatiTemplate[]> {
  return request("/wati-templates");
}

export async function createWatiTemplate(data: {
  templateName: string;
  displayName: string;
  bodyPreview?: string;
  params?: WatiTemplateParam[];
}): Promise<WatiTemplate> {
  return request("/wati-templates", { method: "POST", body: JSON.stringify(data) });
}

export async function updateWatiTemplate(
  id: string,
  data: { templateName?: string; displayName?: string; bodyPreview?: string; params?: WatiTemplateParam[] }
): Promise<WatiTemplate> {
  return request(`/wati-templates/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export async function activateWatiTemplate(id: string): Promise<WatiTemplate> {
  return request(`/wati-templates/${id}/activate`, { method: "POST" });
}

export async function deactivateWatiTemplate(id: string): Promise<WatiTemplate> {
  return request(`/wati-templates/${id}/deactivate`, { method: "POST" });
}



export async function parseWatiVariables(bodyPreview: string): Promise<{ variables: string[] }> {
  return request("/wati-templates/parse-variables", {
    method: "POST",
    body: JSON.stringify({ bodyPreview }),
  });
}

export interface WatiRemoteTemplate {
  id: string;
  elementName: string;
  status: string;
  body?: string;
  bodyOriginal?: string;
  category?: string;
  language?: { key: string; value: string; text: string } | string;
  allowTemplateSend?: boolean;
}

export async function fetchWatiTemplatesFromApi(page = 1, pageSize = 100): Promise<{
  templates: WatiRemoteTemplate[];
  total: number;
}> {
  return request(`/wati-templates/fetch-from-wati?page=${page}&pageSize=${pageSize}`);
}

export async function previewWatiTemplate(id: string, sampleData?: {
  teacherName?: string; teacherPhone?: string; teacherEmail?: string;
  school?: string; city?: string; batchId?: string;
  books?: { title: string; specimenUrl: string; productId: string; author?: string }[];
}): Promise<{ templateName: string; params: { name: string; value: string }[] }> {
  return request(`/wati-templates/${id}/preview`, {
    method: "POST",
    body: JSON.stringify(sampleData ?? {}),
  });
}
