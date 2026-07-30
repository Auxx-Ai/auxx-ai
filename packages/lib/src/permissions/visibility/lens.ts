// packages/lib/src/permissions/visibility/lens.ts

import type { Rung } from '../capabilities/rung'
import { RUNG_ORDER } from '../capabilities/rung'

/**
 * A visibility lens — how much of a thread a viewer may see.
 *
 * **Since plan v3/03 P3b this is MAIL'S DOMAIN ALIAS for {@link Rung}**, not a
 * ladder of its own: the same four names, the same order, the same comparators
 * (`satisfiesRung` / `maxRung` / `RUNG_ORDER`). The old `full`/`subject` names
 * were renamed to `read`/`identity` for exactly that reason — an alias whose
 * VALUES differ is not an alias, it is a second vocabulary with a translation
 * layer, and the translation layer is where the `permission === 'view' ? (lens
 * ?? 'full') : 'full'` triplicate lived.
 *
 * `none < metadata < identity < read`:
 *
 * - `none`     — the thread is invisible (dropped from lists, 404 by id).
 * - `metadata` — participants, timestamps, counts, status, assignee, tags.
 * - `identity` — the above + subject line + message envelopes (no body).
 *                Formerly `subject`.
 * - `read`     — everything: body, attachments, snippet, unread state, may act.
 *                Formerly `full`. Mail's read rung confers ACTING (reply /
 *                assign) — `INSTANCE_ACCESS_RESOURCES.thread.actAt`.
 *
 * The type is a narrowing, so mail can never accidentally hold `edit`/`admin`
 * (which mean managing the INBOX, not a thread — `INBOX_RUNGS`) while every
 * `Rung` comparator accepts a `Lens` unchanged.
 */
export type Lens = Extract<Rung, 'none' | 'metadata' | 'identity' | 'read'>

/** All lenses in ascending order. */
export const ALL_LENSES: readonly Lens[] = ['none', 'metadata', 'identity', 'read']

/**
 * Clamp a stored {@link Rung} onto the thread-lens ladder: `edit`/`admin` on a
 * mailbox (or on a record a thread hangs off) mean "manages the object", and the
 * widest a THREAD can ever be seen at is `read`.
 *
 * **This is the whole remainder of the old `grantLens`.** That helper existed to
 * decode the two-column `(permission, lens)` encoding —
 * `permission === 'view' ? (lens ?? 'full') : 'full'` — and it was written out
 * THREE times in the codebase, once wrongly: the `!== 'view' ⇒ full` shorthand
 * read the `none` RESTRICTION marker as a full grant to every org member (plan
 * 40 §4.1). With one column there is nothing to decode, `none` carries its own
 * meaning, and all that survives is this order-preserving clamp.
 *
 * Since plan v3/03 P4 the composed blob stores raw `Rung`s rather than
 * pre-clamped lenses, so this runs at READ time — and that is enforced by the
 * type system rather than by discipline: `Lens` is a narrowing of `Rung`, so a
 * reader that folds a stored rung into a lens without clamping is a compile
 * error, not a silently widened lens.
 */
export function rungAsLens(rung: Rung): Lens {
  return RUNG_ORDER[rung] >= RUNG_ORDER.read ? 'read' : (rung as Lens)
}

/**
 * Coerce an untrusted value (e.g. a SINGLE_SELECT field-value read, which
 * surfaces as a one-element array) to a valid scalar {@link Lens}. Arrays
 * poison every strict lens comparison downstream — `['none'] !== 'none'`
 * skips the restricted-inbox drop, `['read'] !== 'read'` redacts full
 * viewers — so every lens read from a field value MUST pass through here.
 */
export function normalizeLens(value: unknown, fallback: Lens = 'read'): Lens {
  const scalar = Array.isArray(value) ? value[0] : value
  return (ALL_LENSES as readonly unknown[]).includes(scalar) ? (scalar as Lens) : fallback
}
