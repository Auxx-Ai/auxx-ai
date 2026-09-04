// packages/lib/src/banking/rules/evaluate.ts

/**
 * The rule engine, PURE (HANDOFF slot 3C, bank plan 03 §4).
 *
 * No `db`, no I/O, nothing async - `evaluateRules` is a plain function over
 * data its caller already holds, so it is exhaustively testable without a
 * database and so `applySuggestions` can run it in a loop without an await
 * per rule. `suggest.ts` is the module's only file that touches Drizzle.
 */

import {
  type BankRuleRecord,
  compileSafeRegex,
  type RuleMatchInput,
  resolveDirection,
} from './client'

/**
 * Priority order, first match wins.
 *
 * `evaluateRules` never returns more than one rule: bank plan 03 §4's three
 * confidence bands assume exactly one proposal per line, and a bookkeeper
 * reviewing "which rule fired" for a coded line needs a single answer.
 * Disabled rules are skipped entirely, not merely deprioritised.
 *
 * Sort is by `priority` ascending (a missing priority reads as `0`), stable
 * on ties - `Array.prototype.sort` has been a stable sort since ES2019, so
 * two rules created in either order at the same priority run in the order
 * they were passed in.
 */
export function evaluateRules(
  rules: readonly BankRuleRecord[],
  transaction: RuleMatchInput
): BankRuleRecord | null {
  const ordered = rules
    .filter((rule) => rule.enabled)
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => (a.rule.priority || 0) - (b.rule.priority || 0) || a.index - b.index)

  for (const { rule } of ordered) {
    if (ruleMatches(rule, transaction)) return rule
  }
  return null
}

/** Whether one rule matches one transaction. Every condition must pass. */
function ruleMatches(rule: BankRuleRecord, transaction: RuleMatchInput): boolean {
  if (rule.bankAccountId && rule.bankAccountId !== transaction.bankAccountId) return false
  if (!directionMatches(rule.direction, transaction.amountMinor)) return false
  if (!amountMatches(rule, transaction.amountMinor)) return false
  return fieldMatches(rule, transaction)
}

function directionMatches(direction: BankRuleRecord['direction'], amountMinor: number): boolean {
  if (direction === 'any') return true
  return direction === resolveDirection(amountMinor)
}

function amountMatches(rule: BankRuleRecord, amountMinor: number): boolean {
  const magnitude = Math.abs(amountMinor)
  if (rule.amountMinMinor != null && magnitude < rule.amountMinMinor) return false
  if (rule.amountMaxMinor != null && magnitude > rule.amountMaxMinor) return false
  return true
}

function fieldMatches(rule: BankRuleRecord, transaction: RuleMatchInput): boolean {
  const value = rule.matchField === 'description' ? transaction.description : transaction.matchKey
  if (!value) return false

  switch (rule.matchOperator) {
    case 'contains':
      return value.toLowerCase().includes(rule.matchValue.toLowerCase())
    case 'equals':
      return value.toLowerCase() === rule.matchValue.toLowerCase()
    case 'starts_with':
      return value.toLowerCase().startsWith(rule.matchValue.toLowerCase())
    case 'regex': {
      const compiled = compileSafeRegex(rule.matchValue)
      // An unsafe or unparseable pattern never matches, rather than throwing
      // mid-ingest - `writes.ts` already refuses it at create/update time, so
      // reaching here with one means older stored data, not a live mistake.
      return compiled ? compiled.test(value) : false
    }
    default:
      return false
  }
}
