// packages/lib/src/permissions/visibility/lens.ts

/**
 * A visibility lens — how much of a thread a viewer may see. Ordered:
 * `none < metadata < subject < full`.
 *
 * - `none`     — the thread is invisible (dropped from lists, 404 by id).
 * - `metadata` — participants, timestamps, counts, status, assignee, tags.
 * - `subject`  — the above + subject line + message envelopes (no body).
 * - `full`     — everything: body, attachments, snippet, unread state, may act.
 */
export type Lens = 'none' | 'metadata' | 'subject' | 'full'

const ORDER: Record<Lens, number> = { none: 0, metadata: 1, subject: 2, full: 3 }

/** All lenses in ascending order. */
export const ALL_LENSES: readonly Lens[] = ['none', 'metadata', 'subject', 'full']

/** The higher of two lenses (grants only ever widen access). */
export const maxLens = (a: Lens, b: Lens): Lens => (ORDER[a] >= ORDER[b] ? a : b)

/** True when `have` is at least `need`. */
export const satisfiesLens = (have: Lens, need: Lens): boolean => ORDER[have] >= ORDER[need]

/** Numeric rank of a lens (for sorting / comparisons). */
export const lensRank = (lens: Lens): number => ORDER[lens]

/**
 * Coerce an untrusted value (e.g. a SINGLE_SELECT field-value read, which
 * surfaces as a one-element array) to a valid scalar {@link Lens}. Arrays
 * poison every strict lens comparison downstream — `['none'] !== 'none'`
 * skips the restricted-inbox drop, `['full'] !== 'full'` redacts full
 * viewers — so every lens read from a field value MUST pass through here.
 */
export function normalizeLens(value: unknown, fallback: Lens = 'full'): Lens {
  const scalar = Array.isArray(value) ? value[0] : value
  return (ALL_LENSES as readonly unknown[]).includes(scalar) ? (scalar as Lens) : fallback
}
