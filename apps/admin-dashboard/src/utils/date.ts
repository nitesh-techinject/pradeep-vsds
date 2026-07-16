/**
 * Parse a date value from various formats (Firestore Timestamp, ISO string, etc.)
 */
function parseDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    const sec = (v._seconds ?? v.seconds) as number | undefined;
    if (typeof sec === "number") {
      const d = new Date(sec * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

/**
 * Safely format a date value for display.
 * Handles Firestore Timestamps, ISO strings, and invalid values.
 */
export function formatDate(value: unknown): string {
  const d = parseDate(value);
  return d ? d.toLocaleDateString() : "—";
}

export function formatDateTime(value: unknown): string {
  const d = parseDate(value);
  return d ? d.toLocaleString() : "—";
}
