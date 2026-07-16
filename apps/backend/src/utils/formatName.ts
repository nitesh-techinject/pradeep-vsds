function capitalize(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Formats an author name string with proper capitalization.
 * Handles comma-separated names, initials attached to surnames (s.c.kheterpal → S.C Kheterpal),
 * standalone initials (s.n → S.N), hyphenated names, and regular words.
 *
 * Examples:
 *   "S.c.kheterpal, S.n.dhawan" → "S.C Kheterpal, S.N Dhawan"
 *   "k.l gomber"                → "K.L Gomber"
 *   "g. chopra"                 → "G. Chopra"
 */
export function formatName(str: string | null | undefined): string {
  if (!str || typeof str !== 'string') return '';

  return str
    .trim()
    .toLowerCase()
    .split(/\s*,\s*|\s*,/)          // split on commas (with optional spaces)
    .map((name) => {
      return name
        .trim()
        .split(/\s+/)               // split each name on spaces
        .map((word) => {
          const parts = word.split('.');

          // Initials attached to surname: s.c.kheterpal → S.C Kheterpal
          if (parts.length > 1) {
            const filtered = parts.filter(Boolean);
            const last = filtered[filtered.length - 1] ?? '';

            // All parts are single chars → pure initials: k.l → K.L, s.n. → S.N
            if (filtered.every((p) => p.length === 1)) {
              return filtered.map((ch) => ch.toUpperCase()).join('.') + (parts[parts.length - 1] === '' ? '.' : '');
            }

            // Trailing dot only (e.g. "g.") → single initial
            if (!last || last.length === 0) {
              return filtered.filter(Boolean).map((ch) => ch.toUpperCase()).join('.') + '.';
            }

            // Mixed: initials + surname: s.c.kheterpal → S.C Kheterpal
            const initials = filtered.slice(0, -1).map((ch) => ch.toUpperCase()).join('.');
            return `${initials} ${capitalize(last)}`;
          }

          return capitalize(word);
        })
        .join(' ');
    })
    .join(', ');
}
