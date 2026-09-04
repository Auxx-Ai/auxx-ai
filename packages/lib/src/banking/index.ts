// packages/lib/src/banking/index.ts

/**
 * Bank accounts and their coverage (HANDOFF slot 2I).
 *
 * 🛑 Server-only. Client code imports `@auxx/lib/banking/client`, which carries
 * the vocabularies, the read models and the pure coverage arithmetic.
 */

export type {
  BankAccountCoverage,
  BankAccountRow,
  BankAccountStatus,
  BankAccountType,
  BankConnectorHealth,
  CoverageGap,
} from './client'
export {
  BANK_ACCOUNT_GL_TYPES,
  BANK_ACCOUNT_STATUS_LABELS,
  BANK_ACCOUNT_STATUSES,
  BANK_ACCOUNT_TYPE_LABELS,
  BANK_ACCOUNT_TYPES,
  COVERAGE_GAP_DAYS,
  CREDIT_SIGN_WARNING,
  computeCoverageGaps,
  daysBetween,
  mergeCoverageGaps,
  resolveBankAccountStatus,
  resolveBankAccountType,
  shiftDateKey,
  toDateKey,
} from './client'
// ── The Stripe Financial Connections feed (HANDOFF slot 3A) ───────────────────
//
// Appended per HANDOFF §9a: a block for this slot's own files, after the final
// existing export. The full surface lives in `./feed`; these are the exports the
// router, the poster (slot 3B) and the worker need.
export type {
  BankConnectionStart,
  BankFeedAccountFacts,
  BankFeedDisconnectResult,
  BankFeedSyncResult,
  BankTransactionPinInput,
  FinancialConnectionsEvent,
  ProvisionedBankFeed,
  ReapCandidate,
  ReapStats,
  ResolvedFeedConnector,
} from './feed'
export {
  applyFinancialConnectionsEvent,
  BANK_FEED_PROVIDER_KEY,
  createFinancialConnectionsSession,
  disconnectAccountAtStripe,
  disconnectBankAccountFeed,
  FC_PROVIDER_KEY,
  FINANCIAL_CONNECTIONS_EVENT_TYPES,
  findReapableBankFeeds,
  isFinancialConnectionsEvent,
  // `normalizeMatchKey` is deliberately NOT re-exported here: slot 3D's `./import`
  // block already re-exports the SAME function (it imports it from `./feed/match-key`
  // rather than reimplementing it), and one implementation is the whole point - two
  // normalisers that disagreed by a stripped digit would turn the file/API overlap band
  // into two rows per transaction instead of one linked pair.
  pinPostedBankTransaction,
  provisionBankFeed,
  REAP_AFTER_DAYS,
  reapBankFeedAccount,
  reapDisconnectedBankFeeds,
  refreshBankAccountCoverage,
  resolveFeedConnectorByAccountId,
  retrieveAccount,
  startBankConnection,
  subscribeToTransactions,
  syncBankAccountFeed,
  unpinPostedBankTransaction,
} from './feed'
// ── Statement file import (HANDOFF slot 3D) ───────────────────────────────
// Appended per HANDOFF §9a: one block, after the final export, touching no
// other slot's lines. See `./import/index.ts` for what each of these is.
export type {
  BankImportBatch,
  BankImportOverlap,
  BankImportRow,
  BankTransactionImportContext,
  BankTransactionRow,
  CoverageEffect,
  FinalizeBankImportResult,
  ReverseImportRefusal,
  ReverseImportResult,
  SavedMapping,
  SavedMappingColumn,
} from './import'
export {
  assignImportedExternalIds,
  BANK_IMPORT_MAPPINGS_KEY,
  BANK_TRANSACTION_IMPORT_ATTRIBUTES,
  buildImportedExternalId,
  CROSS_SOURCE_MATCH_DAYS,
  computeOverlap,
  finalizeBankImport,
  forgetMapping,
  headerSignature,
  hydrateTransactions,
  listImportBatches,
  listSavedMappings,
  MAX_SAVED_MAPPINGS,
  moveCoverage,
  normaliseHeader,
  normaliseMatchKey,
  normalizeMatchKey,
  previewCoverageEffect,
  readProducedRecordIds,
  readSavedMapping,
  readTransactionsByAccount,
  readTransactionsByBatch,
  refusalReason,
  requireBankTransactionImportContext,
  reverseImport,
  saveMapping,
  subtractCoveredRange,
} from './import'
export type { BankAccountFieldContext, BankTransactionFieldContext } from './reads'
export {
  getBankAccount,
  listBankAccounts,
  loadBankAccountFieldContext,
  loadBankTransactionFieldContext,
  readCoverage,
  requireBankAccountFieldContext,
} from './reads'
export type { CreateBankAccountInput, UpdateBankAccountInput } from './writes'
export { createBankAccount, updateBankAccount } from './writes'
