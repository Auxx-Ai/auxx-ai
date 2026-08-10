// packages/lib/src/mail-unsubscribe/index.ts
// Mail-unsubscribe domain barrel (plans/mail-filter/03-suggestions-plan.md §6,
// phase D). Explicit named exports only — see CLAUDE.md's "Module Exports".
//
// ⚠️ Unsubscribe is a ONE-SHOT COMMAND, never a `MailFilterAction` (S2 /
// invariant 1). Nothing here is reachable from the filter engine, and a PR that
// adds `{ type: 'unsubscribe' }` to that union — turning a user-initiated
// request into an outbound POST on every future match — must be rejected.

// Client-safe vocabulary + THE safety gate (also `@auxx/lib/mail-unsubscribe/client`)
export {
  MAIL_UNSUBSCRIBED_FROM_SIGNAL_KIND,
  parseMailSubjectKey,
  parseUnsubscribeMeta,
  selectUnsubscribeMethod,
  toMailSubjectKey,
  UNSUBSCRIBE_IGNORED_AFTER_DAYS,
  type UnsubscribeAlternative,
  type UnsubscribeCandidate,
  type UnsubscribeGateInput,
  type UnsubscribeMeta,
  type UnsubscribeMethod,
  type UnsubscribeOffer,
  type UnsubscribeRefusal,
  type UnsubscribeRefusalReason,
  type UnsubscribeStatus,
  unsubscribeRefusal,
} from './client'
// The three-tier executor (§6.1) + the shared-inbox audit action
export { executeUnsubscribe, MAIL_UNSUBSCRIBE_AUDIT_ACTION } from './execute-unsubscribe'
// Tier 3: mailto, over the existing outbound send path
export {
  type ParsedUnsubscribeMailto,
  parseUnsubscribeMailto,
  resolveInboxSendChannel,
  type SendMailtoUnsubscribeInput,
  type SendMailtoUnsubscribeResult,
  sendMailtoUnsubscribe,
} from './mailto-send'
// Tier 1: the hardened RFC 8058 POST
export {
  assertPublicHttpsUrl,
  ONE_CLICK_BODY,
  type OneClickPostResult,
  postOneClickUnsubscribe,
} from './one-click-post'
// Subject-key → Message predicate (one translation, shared by read + sweep)
export { buildSubjectKeyPredicate } from './subject-key'
// The ignored-unsubscribe measurement (§6.4)
export {
  countMessagesSinceUnsubscribe,
  resolveSweepUpdate,
  type SweepableUnsubscribe,
  type SweepMailUnsubscribesOptions,
  type SweepMailUnsubscribesStats,
  type SweepObservation,
  sweepMailUnsubscribes,
  UNSUBSCRIBE_SWEEP_BATCH,
} from './sweep'
// Types
export type {
  ExecuteUnsubscribeInput,
  ExecuteUnsubscribeOutcome,
  MailUnsubscribeRow,
  SynchronousUnsubscribeStatus,
  UnsubscribeTarget,
} from './types'
export { toMailUnsubscribeRow } from './types'
// §7.1 — the PURE predicate the ROUTER calls. Nothing in lib calls it.
export {
  assertCanUnsubscribe,
  canUnsubscribeOnInbox,
  isSharedInbox,
  type UnsubscribeAuthorityCapabilities,
  type UnsubscribeInbox,
} from './unsubscribe-authority'
// Writes
export {
  applyUnsubscribeSweepObservation,
  setMailUnsubscribeStatus,
  type UpsertMailUnsubscribeInput,
  upsertMailUnsubscribe,
} from './unsubscribe-mutations'
// Reads
export {
  getMailUnsubscribe,
  getMailUnsubscribeById,
  type ListMailUnsubscribesOptions,
  listMailUnsubscribes,
  resolveUnsubscribeTarget,
} from './unsubscribe-queries'
// The `mail:unsubscribed_from` signal — NEVER `contact:unsubscribed` (invariant 2)
export {
  buildUnsubscribeSignalInput,
  recordUnsubscribeSignal,
  type UnsubscribeSignalInput,
} from './unsubscribe-signal'
