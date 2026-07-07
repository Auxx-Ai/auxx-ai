// packages/lib/src/permissions/visibility/index.ts

export { getFullLensAudienceForInbox } from './audience'
export type { VisibilityGrantRow } from './compute-user-mail-visibility'
export {
  composeUserMailVisibility,
  computeUserMailVisibility,
} from './compute-user-mail-visibility'
export type {
  MailViewer,
  SystemVisibility,
  ThreadVisibilityInput,
  UserMailVisibility,
} from './context'
export { isSystemViewer, SYSTEM_VISIBILITY } from './context'
export type { DerivationRule } from './derivation-rules'
export { DERIVATION_RULES } from './derivation-rules'
export { effectiveLens, effectiveLensBatch, inboxLensFor } from './effective-lens'
export type { Lens } from './lens'
export { ALL_LENSES, lensRank, maxLens, satisfiesLens } from './lens'
export {
  FULL_ONLY_THREAD_FIELDS,
  MESSAGE_CONTENT_FIELDS,
  redactMessage,
  redactMessagePatch,
  redactThreadMeta,
  redactThreadPatch,
  SUBJECT_TIER_THREAD_FIELDS,
  THREAD_METADATA_FIELDS,
} from './redact'
export { getThreadLens, getThreadLensBatch } from './thread-lens'
