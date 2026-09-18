// packages/lib/src/accounting/ledger/post/client.ts

export {
  type MonthEndInventorySnapshot,
  POSTING_DRAFT_VERSION,
  type PostingAssertions,
  type PostingDraftV1,
  reverseAssertions,
} from './draft'
// ── plans/accounting/tasks/18: two feeds, one author, unit 1 ───────────────
// Types only - the read touches `@auxx/database` and stays server-only,
// exported from `./index`. The close console's card renders this shape.
export type { DuplicateMovementEntry, DuplicateMovementFinding } from './duplicate-movements'
export { didLedgerAccept, isExpectedPostOutcome } from './ledger-accepted'
// ── plans/accounting/tasks/26 §6: billed fees, shown and never accrued ───────
// Types only. `readRailFeeStatus` makes three database reads and stays
// server-only, exported from `./index`; the close console's Processor fees
// block renders this shape.
// ── plans/accounting/tasks/28 §2: the declared posting policy ────────────────
// PURE. What triggers each posting type, its entry as roles, the settings that
// change it and the sentences the Posting page and the guides render. The four
// regime tables below are derived views of it. `ExportRoute` is re-exported
// through `./roles/regime` and is not repeated here.
export {
  LEDGER_WIDE_SETTING_KEYS,
  POSTING_POLICIES,
  POSTING_POLICY,
  type PostingParameter,
  type PostingPolicy,
  type PostingRecordLink,
  type PostingSettingCopy,
  type PostingTemplateLine,
  type PostingTrigger,
} from './policy'
