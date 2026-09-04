// packages/lib/src/banking/review/index.ts

/**
 * The bank review queue (HANDOFF slot 3B, bank plan ranks 8 and 9).
 *
 * 🛑 Server-only. Client code imports `@auxx/lib/banking/review/client`, which
 * carries the vocabularies, the read models and the pure window arithmetic.
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5).
 */

export {
  BANK_TRANSACTION_POSTING_TYPE,
  type BuildCodedBankEntryInput,
  type BuildTransferEntryInput,
  buildCodedBankEntry,
  buildTransferEntry,
} from './build-entry'
export {
  BANK_PERIOD_KEY_PREFIX,
  BANK_STATUSES,
  BANK_TRANSACTION_SOURCE_TYPE,
  type BankLineFlow,
  type BankStatus,
  type BankTransactionRow,
  bankLineFlow,
  bankTransactionPeriodKey,
  CANDIDATE_AMOUNT_TOLERANCE,
  CANDIDATE_DAY_WINDOW,
  isLinkableTransferLeg,
  isOppositeLeg,
  isWithinAmountTolerance,
  isWithinCandidateWindow,
  MATCH_RECORD_TYPE_LABELS,
  MATCH_RECORD_TYPES,
  MATCHABLE_RECORD_TYPES,
  MATCHED_RECORD_TYPES,
  MAX_PERIOD_KEY_ATTEMPT,
  type MatchCandidate,
  type MatchedRecordType,
  type MatchRecordType,
  pickLinkableTransferLeg,
  pickOppositeLeg,
  REVIEW_QUEUE_STATES,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUSES,
  type ReviewHistoryEntry,
  type ReviewOutcome,
  type ReviewQueueState,
  type ReviewQueueStats,
  type ReviewStatus,
  scoreCandidate,
} from './client'
export {
  getBankTransaction,
  type ListForReviewFilters,
  listForReview,
  listMatchCandidates,
  loadReviewFieldContext,
  type ReviewFieldContext,
  readHistory,
  readQueueStats,
  requireBankTransaction,
  requireReviewFieldContext,
} from './reads'
export {
  type CodeTransactionInput,
  codeTransaction,
  type ExcludeTransactionInput,
  excludeTransaction,
  type MatchTransactionInput,
  matchTransaction,
  type TransferTransactionInput,
  transferTransaction,
  type UndoReviewInput,
  undoReview,
} from './writes'
