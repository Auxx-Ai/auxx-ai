// packages/lib/src/banking/import/index.ts

/**
 * Statement file import: the bank-specific half of the shared CSV importer
 * (HANDOFF slot 3D, plans/bank-connection/05-file-import.md).
 *
 * 🛑 Server-only. Everything here reaches Drizzle, the org cache or the settings
 * service. The one piece the browser needs - the OFX parser - lives in
 * `@auxx/lib/import/client`, because it is pure and belongs to the FORMAT, not
 * to banking.
 *
 * No permission checks anywhere in this module. The router asserts `ledgerView`
 * for the reads and `ledgerPost` for the writes (`docs/lib-module-guide.md` §6).
 */

export { listImportBatches } from './batches'
export {
  CROSS_SOURCE_MATCH_DAYS,
  computeOverlap,
  earliest,
  previewCoverageEffect,
  withinWindow,
} from './coverage-effect'
export type { BankTransactionImportContext, BankTransactionRow } from './fields'
export {
  BANK_TRANSACTION_IMPORT_ATTRIBUTES,
  hydrateTransactions,
  readTransactionsByAccount,
  readTransactionsByBatch,
  requireBankTransactionImportContext,
} from './fields'
export { finalizeBankImport, moveCoverage, readProducedRecordIds } from './finalize'
export { subtractCoveredRange } from './gaps'
export { headerSignature, normaliseHeader } from './header-signature'
export {
  BANK_IMPORT_MAPPINGS_KEY,
  forgetMapping,
  listSavedMappings,
  MAX_SAVED_MAPPINGS,
  readSavedMapping,
  saveMapping,
} from './mappings'
export {
  assignImportedExternalIds,
  buildImportedExternalId,
  normaliseMatchKey,
  normalizeMatchKey,
} from './match-key'
export { refusalReason, reverseImport } from './reverse'
export type {
  BankImportBatch,
  BankImportOverlap,
  BankImportRow,
  CoverageEffect,
  FinalizeBankImportResult,
  ReverseImportRefusal,
  ReverseImportResult,
  SavedMapping,
  SavedMappingColumn,
} from './types'
export { IMPORT_LINK_EXCLUSION_PREFIX } from './types'
