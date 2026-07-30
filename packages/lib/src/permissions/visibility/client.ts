// packages/lib/src/permissions/visibility/client.ts
/**
 * Client-safe exports for the visibility module: the lens type and the
 * redaction field lists / pure projections. No server-only deps — the FE reuses
 * these to render redacted placeholder states.
 *
 * **The comparators are gone, not moved here** (plan v3/03 §11). `Lens` is now a
 * narrowing of `Rung`, so `satisfiesRung` / `maxRung` / `RUNG_ORDER`
 * (`@auxx/lib/permissions/client`) accept a `Lens` directly. Re-exporting
 * mail-flavoured aliases would recreate the second ladder the collapse deleted.
 */

export type { Lens } from './lens'
export { ALL_LENSES, normalizeLens } from './lens'
export type { LensChoice, LensLabel } from './lens-labels'
export { LENS_CHOICES, LENS_LABELS, RUNG_LABELS } from './lens-labels'
export {
  IDENTITY_TIER_THREAD_FIELDS,
  MESSAGE_CONTENT_FIELDS,
  READ_TIER_THREAD_FIELDS,
  redactMessage,
  redactThreadMeta,
  redactThreadPatch,
  THREAD_METADATA_FIELDS,
} from './redact'
