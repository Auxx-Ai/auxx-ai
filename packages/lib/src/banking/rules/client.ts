// packages/lib/src/banking/rules/client.ts

/**
 * The client-safe half of `banking/rules/`: vocabularies and the read model
 * (`docs/lib-module-guide.md` §7, HANDOFF slot 3C).
 *
 * Imports nothing server-only, and carries no `'use client'` directive.
 *
 * ⚠️ Browser code must import `@auxx/lib/banking/rules/client`, never
 * `@auxx/lib/banking/rules`. The barrel reaches Drizzle and the org cache.
 */

/** Mirrors `BANK_RULE_MATCH_FIELD_OPTIONS`. */
export const BANK_RULE_MATCH_FIELDS = ['description', 'matchKey'] as const
export type BankRuleMatchField = (typeof BANK_RULE_MATCH_FIELDS)[number]

/** Mirrors `BANK_RULE_MATCH_OPERATOR_OPTIONS`. */
export const BANK_RULE_MATCH_OPERATORS = ['contains', 'equals', 'starts_with', 'regex'] as const
export type BankRuleMatchOperator = (typeof BANK_RULE_MATCH_OPERATORS)[number]

/** Mirrors `BANK_RULE_DIRECTION_OPTIONS`. */
export const BANK_RULE_DIRECTIONS = ['in', 'out', 'any'] as const
export type BankRuleDirection = (typeof BANK_RULE_DIRECTIONS)[number]

/** Mirrors `BANK_RULE_ACTION_OPTIONS`. */
export const BANK_RULE_ACTIONS = ['code', 'exclude', 'transfer'] as const
export type BankRuleAction = (typeof BANK_RULE_ACTIONS)[number]

/** Mirrors `BANK_TRANSACTION_SUGGESTION_SOURCE_OPTIONS` on `bank-transaction-fields.ts`. */
export const SUGGESTION_SOURCES = ['history', 'rule', 'transfer'] as const
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number]

/** How many historical matches `suggestFromHistory` samples. Bank plan 03 §4's "last 6". */
export const HISTORY_SAMPLE_SIZE = 6

/** The fewest historical matches worth suggesting from. One match is a coincidence. */
export const MIN_HISTORY_MATCHES = 2

/** How many days apart two legs of a transfer may be dated. Bank plan 03 §3.3. */
export const TRANSFER_MATCH_WINDOW_DAYS = 3

/** A safety limit on a hand-typed regex rule. See {@link isSafeRegexPattern}. */
export const MAX_REGEX_PATTERN_LENGTH = 200

/** A `bank_rule` record, as the UI and `evaluateRules` see it. */
export interface BankRuleRecord {
  id: string
  recordId: string
  name: string
  enabled: boolean
  autoApply: boolean
  /** Lower runs first. `evaluateRules` treats a missing priority as `0`. */
  priority: number
  matchField: BankRuleMatchField
  matchOperator: BankRuleMatchOperator
  matchValue: string
  /** Integer minor units, inclusive, unsigned. `null` means no bound. */
  amountMinMinor: number | null
  amountMaxMinor: number | null
  direction: BankRuleDirection
  /** A `bank_account` entity-instance id, or `null` to match any account. */
  bankAccountId: string | null
  action: BankRuleAction
  glAccountCode: string | null
  /** A `bank_account` entity-instance id, required when `action` is `transfer`. */
  counterpartBankAccountId: string | null
  /** A `contact` entity-instance id, optional context for a `code` action. */
  contactId: string | null
  memo: string | null
  appliedCount: number
  lastAppliedAt: string | null
  createdAt: Date | null
}

/** What `evaluateRules` needs from a `bank_transaction` row to test a match. */
export interface RuleMatchInput {
  description: string | null
  matchKey: string | null
  /** Integer minor units, SIGNED - mirrors `bank_transaction.amountMinor`. */
  amountMinor: number
  bankAccountId: string | null
}

/** Which way the money moved, from the signed transaction amount. Zero counts as `in`. */
export function resolveDirection(amountMinor: number): 'in' | 'out' {
  return amountMinor < 0 ? 'out' : 'in'
}

/**
 * `true` when `pattern` is safe to compile and run against every incoming
 * bank line forever.
 *
 * There is no per-call timeout available here - `evaluateRules` runs
 * synchronously on ingest for every enabled rule - so the only defence is
 * refusing the pattern before it is ever compiled. Two heuristics, both
 * conservative (reject rather than risk a false negative):
 *
 * 1. **Length.** A 200+ character hand-typed rule is already a sign somebody
 *    pasted something they do not fully understand.
 * 2. **Nested quantifiers.** `(a+)+`, `(a*)+`, `([a-z]+)+` and their `{n,}`
 *    cousins are the textbook catastrophic-backtracking shape - a quantified
 *    group whose own body is itself quantified.
 */
export function isSafeRegexPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_REGEX_PATTERN_LENGTH) return false
  const nestedQuantifier =
    /\([^()]*[+*][^()]*\)[+*]/.test(pattern) || /\([^()]*[+*][^()]*\)\{\d*,?\d*\}/.test(pattern)
  return !nestedQuantifier
}

/**
 * Compile `pattern` case-insensitively, or `null` when {@link isSafeRegexPattern}
 * refuses it or the pattern does not parse.
 */
export function compileSafeRegex(pattern: string): RegExp | null {
  if (!isSafeRegexPattern(pattern)) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

/** What `suggestFromHistory` and a matching rule both produce, before it is written. */
export interface SuggestionResult {
  source: SuggestionSource
  glAccountCode: string | null
  recordId: string | null
  recordType: string | null
  reason: string
  ruleId: string | null
}
