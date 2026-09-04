// apps/web/src/components/accounting/ui/banking/rules/bank-rule-options.ts

/**
 * The bank-rule vocabularies as select options plus the two summary strings the
 * screen needs: the compact one under a rule's name in the list, and the
 * action-only one on the dialog's drill-in row.
 *
 * Shared by `rules-page.tsx`, `bank-rule-configure-page.tsx` and
 * `bank-rule-action-page.tsx` so a rule reads the same wherever it is shown.
 */

import type {
  BankRuleAction,
  BankRuleDirection,
  BankRuleMatchField,
  BankRuleMatchOperator,
  BankRuleRecord,
} from '@auxx/lib/banking/rules/client'
import type { SelectOption } from '@auxx/types/custom-field'

export const MATCH_FIELD_OPTIONS: SelectOption[] = [
  { value: 'matchKey', label: 'Match key (normalised)', color: 'blue' },
  { value: 'description', label: 'Description (raw)', color: 'gray' },
]

export const MATCH_OPERATOR_OPTIONS: SelectOption[] = [
  { value: 'contains', label: 'Contains', color: 'gray' },
  { value: 'equals', label: 'Equals', color: 'blue' },
  { value: 'starts_with', label: 'Starts with', color: 'teal' },
  { value: 'regex', label: 'Regex', color: 'amber' },
]

export const DIRECTION_OPTIONS: SelectOption[] = [
  { value: 'any', label: 'Any', color: 'gray' },
  { value: 'in', label: 'Money in', color: 'green' },
  { value: 'out', label: 'Money out', color: 'red' },
]

export const ACTION_OPTIONS: SelectOption[] = [
  { value: 'code', label: 'Code to an account', color: 'teal' },
  { value: 'transfer', label: 'Transfer between accounts', color: 'purple' },
  { value: 'exclude', label: 'Exclude', color: 'gray' },
]

/** How the matched field is named in a summary. */
const MATCH_FIELD_LABELS: Record<BankRuleMatchField, string> = {
  matchKey: 'Match key',
  description: 'Description',
}

/** How the operator reads mid-sentence, e.g. "Match key contains ...". */
const MATCH_OPERATOR_LABELS: Record<BankRuleMatchOperator, string> = {
  contains: 'contains',
  equals: 'equals',
  starts_with: 'starts with',
  regex: 'matches',
}

/** `any` contributes nothing to a summary, so it has no label here. */
const DIRECTION_LABELS: Record<Exclude<BankRuleDirection, 'any'>, string> = {
  in: 'Money in',
  out: 'Money out',
}

/** The action half of a rule, as it appears in the list: `Code 6100`. */
export function describeRuleAction(
  rule: Pick<BankRuleRecord, 'action' | 'glAccountCode' | 'counterpartBankAccountId'>,
  resolveAccountName: (id: string) => string | undefined
): string {
  if (rule.action === 'exclude') return 'Exclude'
  if (rule.action === 'transfer') {
    const name = rule.counterpartBankAccountId
      ? resolveAccountName(rule.counterpartBankAccountId)
      : undefined
    return name ? `Transfer to ${name}` : 'Transfer'
  }
  return rule.glAccountCode ? `Code ${rule.glAccountCode}` : 'Code'
}

/**
 * The action as the dialog's drill-in row states it, with the GL account's own
 * name when it is known: `Code to 6100 · Bank fees`.
 */
export function describeActionDetail(input: {
  action: BankRuleAction
  glAccountCode: string
  glAccountName?: string
  counterpartName?: string
}): string {
  if (input.action === 'exclude') return 'Exclude'
  if (input.action === 'transfer') {
    return input.counterpartName ? `Transfer to ${input.counterpartName}` : 'Transfer'
  }
  if (!input.glAccountCode) return 'Code to an account'
  return input.glAccountName
    ? `Code to ${input.glAccountCode} · ${input.glAccountName}`
    : `Code to ${input.glAccountCode}`
}

/**
 * A rule in one line: what it matches, which direction it is limited to, and
 * what it does. `Match key contains "MONTHLY SVC FEE" · Money out · Code 6100`.
 */
export function describeRule(
  rule: BankRuleRecord,
  resolveAccountName: (id: string) => string | undefined
): string {
  const parts = [
    `${MATCH_FIELD_LABELS[rule.matchField]} ${MATCH_OPERATOR_LABELS[rule.matchOperator]} "${rule.matchValue}"`,
  ]
  if (rule.direction !== 'any') parts.push(DIRECTION_LABELS[rule.direction])
  if (rule.bankAccountId) {
    const name = resolveAccountName(rule.bankAccountId)
    if (name) parts.push(name)
  }
  parts.push(describeRuleAction(rule, resolveAccountName))
  return parts.join(' · ')
}
