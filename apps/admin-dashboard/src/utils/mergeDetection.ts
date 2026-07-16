import type { UploadRow } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeGroup {
  indices: number[];
  /** Primary match reason */
  reason: "email" | "phone" | "name_school";
  rows: UploadRow[];
  /** Confidence 0–100 */
  confidence: number;
  /** Human-readable match details e.g. "name: 94%, school: exact" */
  matchDetails: string[];
}

// ---------------------------------------------------------------------------
// Helpers — same algorithm as server-side TeacherService
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Canonical form for phone comparison: 9997016578, +919997016578, 99997016578, 09997016578 → same key */
function normalizePhone(s: string): string {
  const digits = (s || "").replace(/\D/g, "");
  if (!digits || digits.length < 5) return "";
  // 10 digits (Indian mobile 6-9): use as-is
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  // 12 digits starting with 91: use last 10
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  // 11 digits: 0XXXXXXXXXX or 9XXXXXXXXXX -> use last 10
  if (digits.length === 11 && (digits.startsWith("0") || (digits.startsWith("9") && /^[6-9]/.test(digits[1] ?? "")))) {
    return digits.slice(1);
  }
  return digits;
}

function normalizeEmail(s: string): string {
  return (s || "").toLowerCase().trim();
}

/** Sørensen–Dice bigram similarity, 0.0–1.0 */
function bigramSimilarity(a: string, b: string): number {
  const aN = normalize(a);
  const bN = normalize(b);
  if (aN === bN) return 1;
  if (aN.length < 2 || bN.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < aN.length - 1; i++) bigramsA.add(aN.substring(i, i + 2));

  const bigramsB = new Set<string>();
  for (let i = 0; i < bN.length - 1; i++) bigramsB.add(bN.substring(i, i + 2));

  let intersection = 0;
  for (const bg of Array.from(bigramsB)) {
    if (bigramsA.has(bg)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Score two rows against each other using the same weights as the backend.
 * Max raw: name(40) + school_exact(30) + city(10) = 80 → normalized to 0–100.
 */
function scorePair(
  a: UploadRow,
  b: UploadRow,
): { score: number; details: string[] } {
  let raw = 0;
  const details: string[] = [];

  // Name (0–40)
  const nameSim = bigramSimilarity(a.name, b.name);
  const nameRaw = Math.round(nameSim * 40);
  raw += nameRaw;
  if (nameRaw > 0) details.push(`name: ${Math.round(nameSim * 100)}%`);

  // School (0–30 exact, 0–20 fuzzy)
  const schoolA = normalize(a.school);
  const schoolB = normalize(b.school);
  if (schoolA && schoolB) {
    if (schoolA === schoolB) {
      raw += 30;
      details.push("school: exact match");
    } else {
      const schoolSim = bigramSimilarity(a.school, b.school);
      const schoolRaw = Math.round(schoolSim * 20);
      raw += schoolRaw;
      if (schoolRaw > 0) details.push(`school: ${Math.round(schoolSim * 100)}%`);
    }
  }

  // City (0–10, bonus)
  const cityA = normalize((a as any).city || "");
  const cityB = normalize((b as any).city || "");
  if (cityA && cityB && cityA === cityB) {
    raw += 10;
    details.push("city: match");
  }

  // Normalize raw (max 80) → 0–100
  const score = Math.min(100, Math.round((raw / 80) * 100));
  return { score, details };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Two-pass duplicate detection within an uploaded CSV:
 *
 * Pass 1 — Exact signals (100% confidence):
 *   - Same normalized email
 *   - Same normalized phone digits
 *
 * Pass 2 — Fuzzy scoring (every unmatched pair):
 *   - Bigram name similarity + school + city → normalized 0–100
 *   - Shown if score >= 65 (below 65 treat as unrelated)
 *
 * Groups are deduplicated so each row appears in at most one group.
 */
export function detectMergeGroups(rows: UploadRow[]): MergeGroup[] {
  const groups: MergeGroup[] = [];
  const used = new Set<number>();

  // ── Pass 1a: exact email ─────────────────────────────────────────────────
  const byEmail = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const e = normalizeEmail(r.email);
    if (e) {
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e)!.push(i);
    }
  });
  for (const [, indices] of byEmail) {
    if (indices.length < 2) continue;
    const free = indices.filter((i) => !used.has(i));
    if (free.length < 2) continue;
    groups.push({
      indices: free,
      reason: "email",
      rows: free.map((i) => rows[i]),
      confidence: 100,
      matchDetails: ["email: exact match"],
    });
    free.forEach((i) => used.add(i));
  }

  // ── Pass 1b: exact phone ─────────────────────────────────────────────────
  const byPhone = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (used.has(i)) return;
    const p = normalizePhone(r.phone);
    if (p && p.length >= 5) {
      if (!byPhone.has(p)) byPhone.set(p, []);
      byPhone.get(p)!.push(i);
    }
  });
  for (const [, indices] of byPhone) {
    if (indices.length < 2) continue;
    const free = indices.filter((i) => !used.has(i));
    if (free.length < 2) continue;
    groups.push({
      indices: free,
      reason: "phone",
      rows: free.map((i) => rows[i]),
      confidence: 100,
      matchDetails: ["phone: exact match"],
    });
    free.forEach((i) => used.add(i));
  }

  // ── Pass 2: fuzzy name+school scoring (all unmatched pairs) ─────────────
  // O(n²) but CSV uploads are typically < 1000 rows, so this is fine.
  const freeIndices = rows.map((_, i) => i).filter((i) => !used.has(i));

  // Build a union-find style grouping: bestPair per index
  // We collect all pairs with score >= 65, then group connected components
  interface ScoredPair {
    i: number;
    j: number;
    score: number;
    details: string[];
  }
  const pairs: ScoredPair[] = [];

  for (let a = 0; a < freeIndices.length; a++) {
    for (let b = a + 1; b < freeIndices.length; b++) {
      const i = freeIndices[a];
      const j = freeIndices[b];
      const { score, details } = scorePair(rows[i], rows[j]);
      if (score >= 65) {
        pairs.push({ i, j, score, details });
      }
    }
  }

  // Sort strongest first so the highest-confidence pairs get priority
  pairs.sort((a, b) => b.score - a.score);

  // Union-find to cluster connected rows
  const parent = new Map<number, number>();
  const groupScore = new Map<number, number>();
  const groupDetails = new Map<number, string[]>();

  function find(x: number): number {
    if (!parent.has(x)) return x;
    const root = find(parent.get(x)!);
    parent.set(x, root);
    return root;
  }

  function union(x: number, y: number, score: number, details: string[]) {
    const rx = find(x);
    const ry = find(y);
    if (rx === ry) return;
    parent.set(ry, rx);
    // Keep the best score seen for this component
    const existing = groupScore.get(rx) ?? 0;
    if (score > existing) {
      groupScore.set(rx, score);
      groupDetails.set(rx, details);
    }
  }

  for (const { i, j, score, details } of pairs) {
    union(i, j, score, details);
  }

  // Collect components
  const components = new Map<number, number[]>();
  for (const idx of freeIndices) {
    const root = find(idx);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(idx);
  }

  for (const [root, members] of components) {
    if (members.length < 2) continue;
    const score = groupScore.get(root) ?? 65;
    const details = groupDetails.get(root) ?? [];
    groups.push({
      indices: members,
      reason: "name_school",
      rows: members.map((i) => rows[i]),
      confidence: score,
      matchDetails: details,
    });
  }

  return groups;
}

/**
 * Merge rows into one: combine books, collect all phones and emails.
 */
export function mergeRows(rows: UploadRow[]): {
  name: string;
  phone: string;
  email: string;
  school: string;
  books: string;
  phones: string[];
  emails: string[];
} {
  const phones = Array.from(new Set(rows.map((r) => r.phone).filter(Boolean)));
  const emails = Array.from(new Set(rows.map((r) => r.email).filter(Boolean)));
  const booksSet = new Set<string>();
  rows.forEach((r) => {
    (r.books || "")
      .split(/[,;]/)
      .map((b) => b.trim())
      .filter(Boolean)
      .forEach((b) => booksSet.add(b));
  });
  const first = rows[0];
  return {
    name: first?.name || "",
    phone: phones[0] || "",
    email: emails[0] || "",
    school: first?.school || "",
    books: Array.from(booksSet).join(", "),
    phones,
    emails,
  };
}
