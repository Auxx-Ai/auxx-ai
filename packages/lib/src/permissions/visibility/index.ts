// packages/lib/src/permissions/visibility/index.ts

export { getFullLensAudienceForInbox } from './audience'
export { getAutomationVisibility } from './automation-visibility'
export type { VisibilityGrantRow } from './compute-user-mail-visibility'
export {
  composeUserMailVisibility,
  computeUserMailVisibility,
} from './compute-user-mail-visibility'
export type {
  AutomationVisibility,
  MailViewer,
  SystemVisibility,
  ThreadVisibilityInput,
  UserMailVisibility,
} from './context'
export { isAutomationViewer, isSystemViewer, isUserViewer, SYSTEM_VISIBILITY } from './context'
export type { DerivationRule } from './derivation-rules'
export { DERIVATION_RULES } from './derivation-rules'
export {
  automationLens,
  effectiveLens,
  effectiveLensBatch,
  inboxLensFor,
} from './effective-lens'
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
export {
  getLoadedThreadLens,
  getThreadLens,
  getThreadLensBatch,
  type LoadedThreadFacts,
} from './thread-lens'
