// packages/lib/src/permissions/visibility/index.ts

export { getFullLensAudienceForInbox } from './audience'
export { getAutomationVisibility } from './automation-visibility'
export {
  composeUserInstanceGrants,
  computeUserInstanceGrants,
} from './compute-user-instance-grants'
export type {
  AutomationVisibility,
  MailViewer,
  SystemVisibility,
  ThreadVisibilityInput,
  UserInstanceGrants,
} from './context'
export {
  CONTACT_GRANT_DEF,
  contactGrants,
  hasContactGrants,
  isAutomationViewer,
  isSystemViewer,
  isUserViewer,
  primaryEntityThreadIdsAtOrAbove,
  primaryEntityThreadRung,
  SYSTEM_VISIBILITY,
  THREAD_GRANT_DEF,
  threadGrants,
} from './context'
export type { DerivationRule } from './derivation-rules'
export { DERIVATION_RULES } from './derivation-rules'
export {
  automationLens,
  effectiveLens,
  effectiveLensBatch,
  inboxLensFor,
} from './effective-lens'
export type { Lens } from './lens'
export { ALL_LENSES, normalizeLens } from './lens'
export {
  IDENTITY_TIER_THREAD_FIELDS,
  MESSAGE_CONTENT_FIELDS,
  READ_TIER_THREAD_FIELDS,
  redactMessage,
  redactMessagePatch,
  redactThreadMeta,
  redactThreadPatch,
  THREAD_METADATA_FIELDS,
} from './redact'
export {
  getLoadedThreadLens,
  getThreadLens,
  getThreadLensBatch,
  type LoadedThreadFacts,
} from './thread-lens'
