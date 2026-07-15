// packages/lib/src/signals/index.ts
// Signals domain barrel (client-notifications plan §4.1 decision #16 — a scoped slice of
// plans/signals/01-signal-store.md). Explicit named exports only — see CLAUDE.md's "Module
// Exports" convention.

export type { SignalWithLinks } from './queries'
export { listSignalsForRecordKeys, SIGNAL_RECORD_KEYS_MAX } from './queries'
export type { RecordSignalInput, SignalRecordKind } from './record-signal'
export { recordSignal, toSignalRecordKey } from './record-signal'
