/**
 * WatiService — WATI WhatsApp Business API.
 * Centralizes template caching, phone normalization, and bulk message sending.
 */
import { config } from '@/config';
import { db } from '@/db';
import { watiTemplates } from '@/db/schema';
import { eq, gte, asc, desc, and } from 'drizzle-orm';
import { resolveParams } from './TemplateEngine';
import { logApiCall } from '@/services/ApiCallLogger';

// ─── Template cache (60s TTL) ─────────────────────────────────────────────────

const templateCache = new Map<number, { template: unknown; cachedAt: number }>();
const CACHE_TTL = 60_000;

export function clearTemplateCache() { templateCache.clear(); }

export async function getCachedTemplate(bookCount: number) {
  const cached = templateCache.get(bookCount);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached.template;
  const template = await getTemplateForBookCount(bookCount);
  templateCache.set(bookCount, { template, cachedAt: Date.now() });
  return template;
}

async function getTemplateForBookCount(bookCount: number) {
  const fitting = await db.query.watiTemplates.findMany({
    where: and(eq(watiTemplates.isActive, true), gte(watiTemplates.bookCount, bookCount)),
    orderBy: [asc(watiTemplates.bookCount)],
    limit: 1,
  });
  if (fitting.length > 0) return fitting[0]!;

  const largest = await db.query.watiTemplates.findMany({
    where: eq(watiTemplates.isActive, true),
    orderBy: [desc(watiTemplates.bookCount)],
    limit: 1,
  });
  if (largest.length > 0 && largest[0]!.bookCount !== null) return largest[0]!;

  return db.query.watiTemplates.findFirst({
    where: eq(watiTemplates.isActive, true),
  });
}

// ─── Phone normalization ──────────────────────────────────────────────────────

export function normalizeIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1);
  return digits;
}

// ─── Phone validation ─────────────────────────────────────────────────────────

/**
 * Valid Indian mobile: after normalization must be 12 digits starting with 91,
 * and the 10-digit subscriber number must start with 6–9.
 */
export function isPhoneValid(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  const normalized = normalizeIndianPhone(phone);
  return /^91[6-9]\d{9}$/.test(normalized);
}

// ─── Bulk Send ────────────────────────────────────────────────────────────────

export type BulkWAMessage = {
  commLogId: string;
  phone: string;
  name: string;
  books: { title: string; specimenUrl: string; productId: string; author?: string | null }[];
  batchId: string;
  school?: string;
  city?: string;
  email?: string;
};

const BULK_CHUNK_SIZE = 100;

/**
 * Send WhatsApp template messages in bulk via WATI v2 API.
 * Groups messages by book count (same template per group),
 * then chunks each group into batches of 100.
 * Returns which commLogIds were sent and which failed.
 */
export async function sendWhatsAppBulk(
  messages: BulkWAMessage[]
): Promise<{ sentIds: string[]; failedIds: string[]; errors: Record<string, string> }> {
  if (config.disableMessaging) {
    console.log(`[WatiService] DISABLE_MESSAGING=true — skipping ${messages.length} WhatsApp sends`);
    return { sentIds: messages.map((m) => m.commLogId), failedIds: [], errors: {} };
  }
  if (!config.wati.baseUrl || !config.wati.apiKey) {
    throw new Error('WATI not configured');
  }

  const sentIds: string[] = [];
  const failedIds: string[] = [];
  const errors: Record<string, string> = {};

  // Validate phone numbers before grouping — filter out invalid ones up front
  const valid: BulkWAMessage[] = [];
  for (const msg of messages) {
    if (isPhoneValid(msg.phone)) {
      valid.push(msg);
    } else {
      const reason = `Invalid phone number: ${msg.phone}`;
      console.warn(`[WatiService] skipping invalid phone: ${msg.phone}`);
      errors[msg.commLogId] = reason;
      failedIds.push(msg.commLogId);
    }
  }

  if (valid.length === 0) {
    console.log(`[WatiService] all ${messages.length} phone numbers invalid — nothing to send`);
    return { sentIds, failedIds, errors };
  }

  console.log(`[WatiService] ${valid.length} valid, ${failedIds.length} invalid phones (of ${messages.length})`);

  // Group by book count — all messages in one WATI request must share a template
  const groups = new Map<number, BulkWAMessage[]>();
  for (const msg of valid) {
    const count = msg.books.length;
    if (!groups.has(count)) groups.set(count, []);
    groups.get(count)!.push(msg);
  }

  for (const [bookCount, group] of groups) {
    const tmpl = await getCachedTemplate(bookCount) as typeof watiTemplates.$inferSelect | undefined;
    const templateName = tmpl?.templateName ?? config.wati.templateName ?? 'specimen_dispatch';

    for (let i = 0; i < group.length; i += BULK_CHUNK_SIZE) {
      const chunk = group.slice(i, i + BULK_CHUNK_SIZE);

      const receivers = chunk.map((msg) => {
        const params = tmpl?.params
          ? resolveParams(tmpl.params, {
              teacherName: msg.name,
              teacherPhone: msg.phone,
              teacherEmail: msg.email,
              school: msg.school,
              city: msg.city,
              batchId: msg.batchId,
              books: msg.books,
            })
          : [
              { name: 'name', value: msg.name },
              { name: 'specimen_details', value: msg.books.map((b) => `${b.title}: ${b.specimenUrl}`).join('\n') },
            ];

        return {
          whatsappNumber: normalizeIndianPhone(msg.phone),
          customParams: params.map((p) => ({ name: p.name, value: p.value })),
        };
      });

      const url = `${config.wati.baseUrl}/api/v2/sendTemplateMessages`;
      const batchId = chunk[0]?.batchId ?? 'bulk';
      const requestBody = { template_name: templateName, broadcast_name: batchId, receivers };
      const t0 = Date.now();
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.wati.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        const latencyMs = Date.now() - t0;

        if (response.ok) {
          const responseBody = await response.json().catch(() => null);
          sentIds.push(...chunk.map((m) => m.commLogId));
          console.log(`[wati] bulk chunk sent: ${chunk.length} msgs (template=${templateName})`);
          await logApiCall({
            service: 'wati',
            endpoint: '/api/v2/sendTemplateMessages',
            requestBody: { template_name: templateName, broadcast_name: batchId, receiverCount: receivers.length },
            responseBody,
            statusCode: response.status,
            latencyMs,
            batchId: chunk[0]?.batchId,
            requestCount: chunk.length,
          });
        } else {
          const text = await response.text();
          const errMsg = `HTTP ${response.status}: ${text.slice(0, 200)}`;
          console.error(`[wati] bulk chunk failed ${response.status}: ${text}`);
          for (const msg of chunk) errors[msg.commLogId] = errMsg;
          failedIds.push(...chunk.map((m) => m.commLogId));
          await logApiCall({
            service: 'wati',
            endpoint: '/api/v2/sendTemplateMessages',
            requestBody: { template_name: templateName, broadcast_name: batchId, receiverCount: receivers.length },
            responseBody: { raw: text },
            statusCode: response.status,
            errorMessage: errMsg,
            latencyMs,
            batchId: chunk[0]?.batchId,
            requestCount: chunk.length,
          });
        }
      } catch (err) {
        const errMsg = (err as Error).message;
        console.error(`[wati] bulk chunk error:`, errMsg);
        for (const msg of chunk) errors[msg.commLogId] = errMsg;
        failedIds.push(...chunk.map((m) => m.commLogId));
        await logApiCall({
          service: 'wati',
          endpoint: '/api/v2/sendTemplateMessages',
          requestBody: { template_name: templateName, broadcast_name: batchId, receiverCount: receivers.length },
          statusCode: 500,
          errorMessage: errMsg,
          latencyMs: Date.now() - t0,
          batchId: chunk[0]?.batchId,
          requestCount: chunk.length,
        });
      }
    }
  }

  return { sentIds, failedIds, errors };
}
