// packages/lib/src/permissions/visibility/client.ts
/**
 * Client-safe exports for the visibility module: the lens type + comparators
 * and the redaction field lists / pure projections. No server-only deps — the
 * FE reuses these to render redacted placeholder states.
 */

export type { Lens } from './lens'
export { ALL_LENSES, lensRank, maxLens, satisfiesLens } from './lens'
export {
  FULL_ONLY_THREAD_FIELDS,
  MESSAGE_CONTENT_FIELDS,
  redactMessage,
  redactThreadMeta,
  redactThreadPatch,
  SUBJECT_TIER_THREAD_FIELDS,
  THREAD_METADATA_FIELDS,
} from './redact'
