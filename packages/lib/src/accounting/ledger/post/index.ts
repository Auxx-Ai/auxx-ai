// packages/lib/src/accounting/ledger/post/index.ts

export { withAccountingCommitLock } from './accounting-commit-lock'
export {
  buildPostingDraft,
  type MonthEndInventorySnapshot,
  POSTING_DRAFT_VERSION,
  type PostingAssertions,
  type PostingDraftV1,
  parsePostingDraft,
  reverseAssertions,
} from './draft'
export {
  discardDraftPosting,
  discardDraftsForSource,
  type UpdateDraftLinesInput,
  updateDraftLines,
} from './draft-lines'
// ── plans/accounting/tasks/18: two feeds, one author, unit 1 ───────────────
export {
  type DuplicateMovementEntry,
  type DuplicateMovementFinding,
  type FindDuplicateBankMovementsOptions,
  findDuplicateBankMovements,
} from './duplicate-movements'
export { didLedgerAccept, isExpectedPostOutcome } from './ledger-accepted'
// ── plans/accounting/tasks/28 §2: the declared posting policy ────────────────
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
export {
  type EntryPreview,
  LEDGER_CURRENCY,
  type PostDraftOptions,
  type PostEntryOptions,
  type PreviewEntryOptions,
  postDraft,
  postEntry,
  previewEntry,
} from './post-entry'
export {
  exportInventoryMovement,
  type InventoryDocumentSubject,
  inventoryTxnDate,
  linkMovementsToPosting,
  postInventoryMovementInTx,
  reverseInventoryMovementPosting,
  reversePostingForMovement,
} from './post-inventory-movement'
export { type PostPayoutEntryOptions, postPayoutEntry } from './post-payout-entry'
export {
  type ReverseEntriesOptions,
  type ReverseEntryOptions,
  reverseEntries,
  reverseEntry,
} from './reverse-entry'
export {
  type BooksBalanceDiscrepancy,
  type BooksBalanceReport,
  verifyBooksBalance,
} from './verify-balance'
