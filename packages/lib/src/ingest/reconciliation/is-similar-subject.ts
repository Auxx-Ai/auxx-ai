// packages/lib/src/ingest/reconciliation/is-similar-subject.ts

/**
 * True when two subjects should be treated as the "same" message subject.
 * Normalizes case and strips reply/forward prefixes, then checks exact match
 * or one containing the other (handles truncated subjects).
 */
export function isSimilarSubject(
  subject1: string | null | undefined,
  subject2: string | null | undefined
): boolean {
  if (!subject1 || !subject2) return false

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/^(re:|fwd:|fw:)\s*/gi, '')
      .trim()

  const normalized1 = normalize(subject1)
  const normalized2 = normalize(subject2)

  if (normalized1 === normalized2) return true
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) return true

  return false
}
