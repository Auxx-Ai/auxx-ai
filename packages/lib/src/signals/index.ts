// packages/lib/src/signals/index.ts
// Signals domain barrel (client-notifications plan §4.1 decision #16 — a scoped slice of
// plans/signals/01-signal-store.md). Explicit named exports only — see CLAUDE.md's "Module
// Exports" convention.

export type { TrackingHitClassification, TrackingHitContext } from './email/bot-detection'
export { classifyTrackingHit } from './email/bot-detection'
export type { InstrumentEmailHtmlInput } from './email/instrument-html'
export { instrumentEmailHtml } from './email/instrument-html'
export type { TrackingTokenPayload } from './email/tracking-tokens'
export {
  buildClickTrackingUrl,
  buildOpenPixelUrl,
  issueClickToken,
  issueOpenToken,
  verifyClickUrl,
  verifyTrackingToken,
} from './email/tracking-tokens'
export type {
  ListSignalsFilters,
  ListSignalsParams,
  ListSignalsResult,
  SignalWithLinks,
} from './queries'
export {
  getSignalById,
  getSignalRollup,
  listSignals,
  listSignalsForRecordKeys,
  SIGNAL_LIST_DEFAULT_LIMIT,
  SIGNAL_LIST_MAX_LIMIT,
  SIGNAL_RECORD_KEYS_MAX,
} from './queries'
export type { RecordSignalInput, SignalRecordKind } from './record-signal'
export { recordSignal, recordSignals, toSignalRecordKey } from './record-signal'
export { SIGNAL_RETENTION_JOB_NAME, signalRetentionJob } from './retention-job'
export type { ApplyRollupForSignalInput } from './rollup'
export { applyRollupForSignal } from './rollup'
export { SIGNAL_ROLLUP_SWEEP_JOB_NAME, signalRollupSweepJob } from './rollup-sweep-job'
export {
  HIGH_VOLUME_SIGNAL_KINDS,
  isSignalKind,
  MESSAGE_SENT_SUBTYPES,
  type MessageSentSubtype,
  SIGNAL_KIND_LIST,
  SIGNAL_KINDS,
  type SignalKind,
  type SignalKindMeta,
} from './types'
