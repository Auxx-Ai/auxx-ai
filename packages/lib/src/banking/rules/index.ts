// packages/lib/src/banking/rules/index.ts

/**
 * Rules and suggestions over `bank_transaction` (HANDOFF slot 3C).
 *
 * 🛑 Server-only. Client code imports `@auxx/lib/banking/rules/client`, which
 * carries the vocabularies, the read model, and the regex-safety guard.
 */

export type {
  BankRuleAction,
  BankRuleDirection,
  BankRuleMatchField,
  BankRuleMatchOperator,
  BankRuleRecord,
  RuleMatchInput,
  SuggestionResult,
  SuggestionSource,
} from './client'
export {
  BANK_RULE_ACTIONS,
  BANK_RULE_DIRECTIONS,
  BANK_RULE_MATCH_FIELDS,
  BANK_RULE_MATCH_OPERATORS,
  compileSafeRegex,
  HISTORY_SAMPLE_SIZE,
  isSafeRegexPattern,
  MIN_HISTORY_MATCHES,
  resolveDirection,
  SUGGESTION_SOURCES,
  TRANSFER_MATCH_WINDOW_DAYS,
} from './client'
export { evaluateRules } from './evaluate'
export type {
  BankRuleFieldContext,
  RuleTransactionFieldContext,
  TransactionMatchRow,
} from './reads'
export {
  findTransferCandidate,
  getBankRule,
  getTransactionMatchRow,
  listBankRules,
  listForReviewTransactionIds,
  listHistoryMatches,
  loadBankRuleFieldContext,
  loadRuleTransactionFieldContext,
  requireBankRuleFieldContext,
  requireRuleTransactionFieldContext,
} from './reads'
export { suggestFromHistory } from './suggest'
export type {
  ApplySuggestionsResult,
  CreateRuleInput,
  UpdateRuleInput,
} from './writes'
export {
  applySuggestions,
  createRule,
  createRuleFromTransaction,
  deleteRule,
  runSuggestionsForAccount,
  updateRule,
} from './writes'
