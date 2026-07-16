/**
 * TemplateEngine — resolves WATI template parameters from order/teacher context.
 *
 * Available data paths:
 *   teacher.name | teacher.phone | teacher.email | teacher.school | teacher.city
 *   order.link   (https://pradeeppublications.com/digital-content/login?email=…&phone=…)
 *   books.{N}.title | books.{N}.specimenUrl | books.{N}.productId | books.{N}.author  (N = 0–11)
 *   batch.id
 */
import type { WatiTemplateParam } from '@/db/schema';
import { formatName } from '@/utils/formatName';

export type TemplateContext = {
  teacherName: string;
  teacherPhone?: string | null;
  teacherEmail?: string | null;
  school?: string | null;
  city?: string | null;
  batchId: string;
  books: Array<{
    title: string;
    specimenUrl: string;
    productId: string;
    author?: string | null;
  }>;
};

// WATI template parameter character limit — URLs need up to 1024 chars
const WATI_PARAM_MAX_LEN = 1024;

function truncate(value: string, max = WATI_PARAM_MAX_LEN): string {
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
}

/** Resolve a single dot-notation path against the context. */
function resolvePath(path: string, ctx: TemplateContext): string {
  const parts = path.split('.');

  if (parts[0] === 'teacher') {
    const field = parts[1];
    if (field === 'name') return ctx.teacherName ?? '';
    if (field === 'phone') return ctx.teacherPhone ?? '';
    if (field === 'email') return ctx.teacherEmail ?? '';
    if (field === 'school') return ctx.school ?? '';
    if (field === 'city') return ctx.city ?? '';
  }

  if (parts[0] === 'order') {
    if (parts[1] === 'link') {
      const email = encodeURIComponent(ctx.teacherEmail ?? '');
      const phone = encodeURIComponent(ctx.teacherPhone ?? '');
      return `https://pradeeppublications.com/digital-content/login?email=${email}&phone=${phone}`;
    }
  }

  if (parts[0] === 'batch') {
    if (parts[1] === 'id') return ctx.batchId ?? '';
  }

  if (parts[0] === 'books') {
    const idx = parseInt(parts[1] ?? '', 10);
    if (!isNaN(idx) && idx >= 0 && idx < ctx.books.length) {
      const book = ctx.books[idx]!;
      const field = parts[2];
      if (field === 'title') return truncate(book.title ?? '');
      if (field === 'specimenUrl') return book.specimenUrl ?? '';
      if (field === 'productId') return book.productId ?? '';
      if (field === 'author') return truncate(formatName(book.author));
    }
    return '';
  }

  return '';
}

/**
 * Build the WATI API `parameters` array from a template's param definitions
 * and a resolved context.
 */
export function resolveParams(
  params: WatiTemplateParam[] | string | unknown,
  ctx: TemplateContext
): Array<{ name: string; value: string }> {
  // params may be stored as a JSON string in the DB — parse it if so
  const list: WatiTemplateParam[] = typeof params === 'string'
    ? JSON.parse(params)
    : Array.isArray(params) ? params : [];

  return list.map(({ paramName, dataPath, fallback }) => ({
    name: paramName,
    // WATI rejects blank parameters — use 'Pradeep Publications' as last resort
    value: resolvePath(dataPath, ctx) || fallback || 'Pradeep Publications',
  }));
}

/**
 * Extract all {{variableName}} tokens from a WATI template body text.
 * Returns them in order of appearance, deduplicated.
 */
export function parseTemplateVariables(body: string): string[] {
  const matches = body.match(/\{\{([^}]+)\}\}/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of matches) {
    const name = m.slice(2, -2).trim();
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}
