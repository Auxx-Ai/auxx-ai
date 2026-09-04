// packages/lib/src/banking/rules/writes.ts

/**
 * Every WRITE in `banking/rules/`: the `bank_rule` CRUD, "create rule from
 * this transaction", and the two entry points that turn a suggestion into
 * written fields on a `bank_transaction` (`applySuggestions`,
 * `runSuggestionsForAccount`) (HANDOFF slot 3C).
 *
 * Writes only. The reads live in `reads.ts`, the pure engine in `evaluate.ts`,
 * the history/transfer producer in `suggest.ts`
 * (`docs/lib-module-guide.md` §5). No permission checks - the router asserts
 * `ledgerPost` (`docs/lib-module-guide.md` §6).
 *
 * ## Auto-apply posts through 3B's writers, never its own SQL
 *
 * An `autoApply` rule's `code`/`exclude`/`transfer` action goes through 3B's
 * `codeTransaction` / `excludeTransaction` / `transferTransaction`
 * (`banking/review/writes.ts`) - the same functions the review drawer's three
 * treatment buttons call. This module never re-implements posting: two
 * independent paths that both build and post a `bank_transaction` entry is
 * exactly the double-count hazard bank plan 03 §2 exists to rule out. See
 * {@link tryAutoApplyAction}.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, type Result } from 'neverthrow'
import { BadRequestError, NotFoundError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { toDateKey } from '../client'
import { codeTransaction, excludeTransaction, transferTransaction } from '../review/writes'
import {
  BANK_RULE_ACTIONS,
  BANK_RULE_DIRECTIONS,
  BANK_RULE_MATCH_FIELDS,
  BANK_RULE_MATCH_OPERATORS,
  type BankRuleAction,
  type BankRuleDirection,
  type BankRuleMatchField,
  type BankRuleMatchOperator,
  type BankRuleRecord,
  isSafeRegexPattern,
  type SuggestionResult,
} from './client'
import { evaluateRules } from './evaluate'
import { guard } from './guard'
import {
  getBankRule,
  getTransactionMatchRow,
  listBankRules,
  listForReviewTransactionIds,
  requireBankRuleFieldContext,
  requireRuleTransactionFieldContext,
} from './reads'
import { suggestFromHistory } from './suggest'

const logger = createScopedLogger('banking:rules')

// ─── bank_rule CRUD ───────────────────────────────────────────────────────

export interface CreateRuleInput {
  organizationId: string
  actorUserId: string
  name: string
  enabled?: boolean
  autoApply?: boolean
  priority?: number
  matchField: BankRuleMatchField
  matchOperator: BankRuleMatchOperator
  matchValue: string
  amountMinMinor?: number | null
  amountMaxMinor?: number | null
  direction?: BankRuleDirection
  bankAccountId?: string | null
  action: BankRuleAction
  glAccountCode?: string | null
  counterpartBankAccountId?: string | null
  contactId?: string | null
  memo?: string | null
}

export interface UpdateRuleInput {
  organizationId: string
  actorUserId: string
  ruleId: string
  name?: string
  enabled?: boolean
  autoApply?: boolean
  priority?: number
  matchField?: BankRuleMatchField
  matchOperator?: BankRuleMatchOperator
  matchValue?: string
  amountMinMinor?: number | null
  amountMaxMinor?: number | null
  direction?: BankRuleDirection
  bankAccountId?: string | null
  action?: BankRuleAction
  glAccountCode?: string | null
  counterpartBankAccountId?: string | null
  contactId?: string | null
  memo?: string | null
}

/** Raise a rule. Refuses a regex match value `evaluateRules` would refuse to run. */
export async function createRule(
  db: Database,
  input: CreateRuleInput
): Promise<Result<BankRuleRecord, Error>> {
  const { organizationId, actorUserId } = input
  return guard(
    async () => {
      const ctx = await requireBankRuleFieldContext(organizationId)
      const name = input.name?.trim()
      if (!name) throw new BadRequestError('A bank rule needs a name')
      assertVocabulary('match field', BANK_RULE_MATCH_FIELDS, input.matchField)
      assertVocabulary('direction', BANK_RULE_DIRECTIONS, input.direction ?? 'any')
      assertMatchValue(input.matchOperator, input.matchValue)
      assertActionPayload(input.action, input.glAccountCode, input.counterpartBankAccountId)

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      const created = await crud.create(ctx.bankRuleDefId, {
        bank_rule_name: name,
        bank_rule_enabled: input.enabled ?? true,
        bank_rule_auto_apply: input.autoApply ?? false,
        bank_rule_priority: input.priority ?? 0,
        bank_rule_match_field: input.matchField,
        bank_rule_match_operator: input.matchOperator,
        bank_rule_match_value: input.matchValue.trim(),
        bank_rule_amount_min: input.amountMinMinor ?? undefined,
        bank_rule_amount_max: input.amountMaxMinor ?? undefined,
        bank_rule_direction: input.direction ?? 'any',
        bank_rule_bank_account: input.bankAccountId || undefined,
        bank_rule_action: input.action,
        bank_rule_gl_account: input.glAccountCode?.trim() || undefined,
        bank_rule_counterpart_bank_account: input.counterpartBankAccountId || undefined,
        bank_rule_contact: input.contactId || undefined,
        bank_rule_memo: input.memo?.trim() || undefined,
        bank_rule_applied_count: 0,
      })

      const row = await getBankRule(db, { organizationId, ruleId: created.instance.id })
      if (row.isErr()) throw row.error
      if (!row.value) throw new NotFoundError('The rule could not be read back after writing')

      logger.info('Created bank rule', { organizationId, ruleId: created.instance.id })
      return row.value
    },
    'Failed to create bank rule',
    { organizationId }
  )
}

/** Edit a rule. Every field is independently optional - `undefined` means "leave it alone". */
export async function updateRule(
  db: Database,
  input: UpdateRuleInput
): Promise<Result<BankRuleRecord, Error>> {
  const { organizationId, actorUserId, ruleId } = input
  return guard(
    async () => {
      const ctx = await requireBankRuleFieldContext(organizationId)
      const existing = await getBankRule(db, { organizationId, ruleId })
      if (existing.isErr()) throw existing.error
      if (!existing.value) throw new NotFoundError(`Bank rule ${ruleId} was not found`)

      if (input.matchField !== undefined) {
        assertVocabulary('match field', BANK_RULE_MATCH_FIELDS, input.matchField)
      }
      if (input.direction !== undefined) {
        assertVocabulary('direction', BANK_RULE_DIRECTIONS, input.direction)
      }
      const matchOperator = input.matchOperator ?? existing.value.matchOperator
      const matchValue = input.matchValue ?? existing.value.matchValue
      assertMatchValue(matchOperator, matchValue)

      const action = input.action ?? existing.value.action
      const glAccountCode =
        input.glAccountCode !== undefined ? input.glAccountCode : existing.value.glAccountCode
      const counterpart =
        input.counterpartBankAccountId !== undefined
          ? input.counterpartBankAccountId
          : existing.value.counterpartBankAccountId
      assertActionPayload(action, glAccountCode, counterpart)

      const patch: Record<string, unknown> = {}
      if (input.name !== undefined) {
        const name = input.name.trim()
        if (!name) throw new BadRequestError('A bank rule needs a name')
        patch.bank_rule_name = name
      }
      if (input.enabled !== undefined) patch.bank_rule_enabled = input.enabled
      if (input.autoApply !== undefined) patch.bank_rule_auto_apply = input.autoApply
      if (input.priority !== undefined) patch.bank_rule_priority = input.priority
      if (input.matchField !== undefined) patch.bank_rule_match_field = input.matchField
      if (input.matchOperator !== undefined) patch.bank_rule_match_operator = input.matchOperator
      if (input.matchValue !== undefined) patch.bank_rule_match_value = input.matchValue.trim()
      if (input.amountMinMinor !== undefined) patch.bank_rule_amount_min = input.amountMinMinor
      if (input.amountMaxMinor !== undefined) patch.bank_rule_amount_max = input.amountMaxMinor
      if (input.direction !== undefined) patch.bank_rule_direction = input.direction
      if (input.bankAccountId !== undefined) patch.bank_rule_bank_account = input.bankAccountId
      if (input.action !== undefined) patch.bank_rule_action = input.action
      if (input.glAccountCode !== undefined) {
        patch.bank_rule_gl_account = input.glAccountCode?.trim() || null
      }
      if (input.counterpartBankAccountId !== undefined) {
        patch.bank_rule_counterpart_bank_account = input.counterpartBankAccountId
      }
      if (input.contactId !== undefined) patch.bank_rule_contact = input.contactId
      if (input.memo !== undefined) patch.bank_rule_memo = input.memo?.trim() || null

      if (Object.keys(patch).length > 0) {
        const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
        await crud.update(toRecordId(ctx.bankRuleDefId, ruleId), patch)
      }

      const row = await getBankRule(db, { organizationId, ruleId })
      if (row.isErr()) throw row.error
      if (!row.value) throw new NotFoundError('The rule could not be read back after writing')

      logger.info('Updated bank rule', { organizationId, ruleId, fields: Object.keys(patch) })
      return row.value
    },
    'Failed to update bank rule',
    { organizationId, ruleId }
  )
}

/** Archive a rule. Soft delete - the `EntityInstance` precedent, and a reversible one. */
export async function deleteRule(
  db: Database,
  params: { organizationId: string; actorUserId: string; ruleId: string }
): Promise<Result<void, Error>> {
  const { organizationId, actorUserId, ruleId } = params
  return guard(
    async () => {
      const ctx = await requireBankRuleFieldContext(organizationId)
      const existing = await getBankRule(db, { organizationId, ruleId })
      if (existing.isErr()) throw existing.error
      if (!existing.value) throw new NotFoundError(`Bank rule ${ruleId} was not found`)

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.archive(toRecordId(ctx.bankRuleDefId, ruleId))
      logger.info('Archived bank rule', { organizationId, ruleId })
    },
    'Failed to delete bank rule',
    { organizationId, ruleId }
  )
}

/**
 * "Create rule from this" - the code panel's toggle (ui-plan.md §2.8 item 4).
 *
 * A `contains` rule on the transaction's own normalised `matchKey`, scoped to
 * its bank account (the panel a reviewer clicks this from is already scoped
 * to one line on one account), `code`-ing to the account they just picked.
 * `matchKey` rather than raw `description` because that is the whole point of
 * normalising it at ingest - a stable pattern that will match the NEXT line
 * from the same payee, not just this one.
 */
export async function createRuleFromTransaction(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    transactionId: string
    glAccountCode: string
    name?: string
  }
): Promise<Result<BankRuleRecord, Error>> {
  const { organizationId, actorUserId, transactionId, glAccountCode } = params
  return guard(
    async () => {
      const rowResult = await getTransactionMatchRow(db, { organizationId, transactionId })
      if (rowResult.isErr()) throw rowResult.error
      const row = rowResult.value
      if (!row) throw new NotFoundError('Bank transaction not found', { transactionId })
      if (!row.matchKey) {
        throw new BadRequestError('This line has no match key to build a rule from')
      }
      const code = glAccountCode.trim()
      if (!code) throw new BadRequestError('A code rule needs a GL account')

      const created = await createRule(db, {
        organizationId,
        actorUserId,
        name: params.name?.trim() || `Auto: ${row.matchKey}`.slice(0, 200),
        matchField: 'matchKey',
        matchOperator: 'contains',
        matchValue: row.matchKey,
        direction: 'any',
        bankAccountId: row.bankAccountId ?? undefined,
        action: 'code',
        glAccountCode: code,
      })
      if (created.isErr()) throw created.error
      return created.value
    },
    'Failed to create rule from transaction',
    { organizationId, transactionId }
  )
}

// ─── Applying suggestions ─────────────────────────────────────────────────

export interface ApplySuggestionsResult {
  /** How many `for_review` lines got a suggestion written (rule or history). */
  suggested: number
  /** How many of those matched a rule, whether or not it is `autoApply`. */
  ruleMatched: number
  /** Always `0` until 3B's `banking/review/writes.ts` lands. See the file header. */
  autoApplied: number
  /** How many `for_review` lines had nothing to suggest. */
  skipped: number
}

/**
 * Run rule evaluation, then suggest-from-history, over a specific set of
 * `bank_transaction` ids. Only lines currently `for_review` are touched -
 * a line already `suggested`, `matched`, `coded` or `excluded` is a human or
 * an earlier run's decision and is left alone.
 */
export async function applySuggestions(
  db: Database,
  params: { organizationId: string; actorUserId: string; transactionIds: string[] }
): Promise<Result<ApplySuggestionsResult, Error>> {
  const { organizationId, actorUserId, transactionIds } = params
  return guard(
    async () => {
      const txCtx = await requireRuleTransactionFieldContext(organizationId)
      const rulesResult = await listBankRules(db, { organizationId, enabledOnly: true })
      if (rulesResult.isErr()) throw rulesResult.error
      const rules = rulesResult.value

      const result: ApplySuggestionsResult = {
        suggested: 0,
        ruleMatched: 0,
        autoApplied: 0,
        skipped: 0,
      }
      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)

      for (const transactionId of transactionIds) {
        const rowResult = await getTransactionMatchRow(db, { organizationId, transactionId })
        if (rowResult.isErr()) throw rowResult.error
        const row = rowResult.value
        if (!row || row.reviewStatus !== 'for_review') {
          result.skipped++
          continue
        }

        const matchedRule = evaluateRules(rules, {
          description: row.description,
          matchKey: row.matchKey,
          amountMinor: row.amountMinor,
          bankAccountId: row.bankAccountId,
        })

        let suggestion: SuggestionResult | null = null
        if (matchedRule) {
          result.ruleMatched++

          if (matchedRule.autoApply) {
            const applied = await tryAutoApplyAction(db, {
              organizationId,
              actorUserId,
              transactionId,
              rule: matchedRule,
            })
            if (applied) {
              result.autoApplied++
              // 🛑 The counter is bumped HERE, not on the match above. "Applied"
              // has to mean the rule actually coded, transferred or excluded a
              // line: a rule that only ever proposed - because it is not
              // `autoApply`, or because the period was locked and
              // `tryAutoApplyAction` answered false - would otherwise report an
              // applied count and a `lastAppliedAt` for work nobody did, which
              // is the number a person reads to decide whether to trust it.
              await bumpRuleApplied(db, { organizationId, actorUserId, ruleId: matchedRule.id })
              // codeTransaction/transferTransaction/excludeTransaction already
              // stamped reviewStatus and (for code/transfer) the posting - the
              // suggestion write below would be redundant and would leave
              // reviewStatus at 'suggested', undoing what just posted.
              continue
            }
          }
          suggestion = ruleToSuggestion(matchedRule)
        } else {
          const historyResult = await suggestFromHistory(db, { organizationId, transactionId })
          if (historyResult.isErr()) throw historyResult.error
          suggestion = historyResult.value
        }

        if (!suggestion) {
          result.skipped++
          continue
        }

        await crud.update(toRecordId(txCtx.bankTransactionDefId, transactionId), {
          bank_transaction_suggested_gl_account: suggestion.glAccountCode ?? null,
          bank_transaction_suggested_record_id: suggestion.recordId ?? null,
          bank_transaction_suggested_record_type: suggestion.recordType ?? null,
          bank_transaction_suggestion_reason: suggestion.reason,
          bank_transaction_suggestion_source: suggestion.source,
          bank_transaction_rule_id: matchedRule?.id ?? null,
          bank_transaction_review_status: 'suggested',
        })
        result.suggested++
      }

      logger.info('Applied bank rule suggestions', { organizationId, ...result })
      return result
    },
    'Failed to apply bank rule suggestions',
    { organizationId, count: transactionIds.length }
  )
}

/** {@link applySuggestions} over every `for_review` line, optionally on one account. */
export async function runSuggestionsForAccount(
  db: Database,
  params: { organizationId: string; actorUserId: string; bankAccountId?: string }
): Promise<Result<ApplySuggestionsResult, Error>> {
  const { organizationId, actorUserId, bankAccountId } = params
  const idsResult = await listForReviewTransactionIds(db, { organizationId, bankAccountId })
  if (idsResult.isErr()) return err(idsResult.error)
  return applySuggestions(db, { organizationId, actorUserId, transactionIds: idsResult.value })
}

/**
 * Actually perform an `autoApply` rule's action, through 3B's own writers -
 * never a second build-and-post path (see the file header).
 *
 * Returns `false` on ANY refusal (a locked period, an invalid code, a missing
 * counterpart) rather than throwing: `applySuggestions` then falls back to
 * writing the suggestion fields and leaving `reviewStatus` at `suggested`,
 * which is the safe default - a rule that silently posted a WRONG entry is
 * worse than one that merely pre-filled a suggestion for a person to accept.
 */
async function tryAutoApplyAction(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    transactionId: string
    rule: BankRuleRecord
  }
): Promise<boolean> {
  const { organizationId, actorUserId, transactionId, rule } = params

  if (rule.action === 'code') {
    if (!rule.glAccountCode) return false
    const outcome = await codeTransaction(db, {
      organizationId,
      actorUserId,
      transactionId,
      glAccountCode: rule.glAccountCode,
      memo: rule.memo ?? undefined,
    })
    if (outcome.isErr() || outcome.value.transaction.reviewStatus !== 'coded') return false
  } else if (rule.action === 'transfer') {
    if (!rule.counterpartBankAccountId) return false
    const outcome = await transferTransaction(db, {
      organizationId,
      actorUserId,
      transactionId,
      counterpartBankAccountId: rule.counterpartBankAccountId,
      memo: rule.memo ?? undefined,
    })
    if (outcome.isErr()) return false
    const status = outcome.value.transaction.reviewStatus
    if (status !== 'coded' && status !== 'matched') return false
  } else if (rule.action === 'exclude') {
    const outcome = await excludeTransaction(db, {
      organizationId,
      actorUserId,
      transactionId,
      reason: `Auto-applied by rule "${rule.name}"`,
    })
    if (outcome.isErr() || outcome.value.transaction.reviewStatus !== 'excluded') return false
  } else {
    return false
  }

  // codeTransaction/transferTransaction/excludeTransaction stamp everything
  // about the review except which RULE did it - stamp that one field so "how
  // much of my queue is automatic" is answerable per line, not just per rule.
  const ctx = await requireRuleTransactionFieldContext(organizationId)
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  await crud.update(toRecordId(ctx.bankTransactionDefId, transactionId), {
    bank_transaction_rule_id: rule.id,
  })
  return true
}

async function bumpRuleApplied(
  db: Database,
  params: { organizationId: string; actorUserId: string; ruleId: string }
): Promise<void> {
  const { organizationId, actorUserId, ruleId } = params
  const ctx = await requireBankRuleFieldContext(organizationId)
  const existing = await getBankRule(db, { organizationId, ruleId })
  if (existing.isErr() || !existing.value) return
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  await crud.update(toRecordId(ctx.bankRuleDefId, ruleId), {
    bank_rule_applied_count: existing.value.appliedCount + 1,
    bank_rule_last_applied_at: toDateKey(new Date()),
  })
}

function ruleToSuggestion(rule: BankRuleRecord): SuggestionResult | null {
  if (rule.action === 'code') {
    if (!rule.glAccountCode) return null
    return {
      source: 'rule',
      glAccountCode: rule.glAccountCode,
      recordId: null,
      recordType: null,
      reason: `Rule "${rule.name}" matched.`,
      ruleId: rule.id,
    }
  }
  if (rule.action === 'transfer') {
    if (!rule.counterpartBankAccountId) return null
    return {
      source: 'rule',
      glAccountCode: null,
      recordId: rule.counterpartBankAccountId,
      recordType: 'bank_account',
      reason: `Rule "${rule.name}" matched.`,
      ruleId: rule.id,
    }
  }
  // exclude
  return {
    source: 'rule',
    glAccountCode: null,
    recordId: null,
    recordType: null,
    reason: `Rule "${rule.name}" matched.`,
    ruleId: rule.id,
  }
}

function assertVocabulary<T extends string>(label: string, allowed: readonly T[], value: T): void {
  if (!allowed.includes(value)) {
    throw new BadRequestError(`"${value}" is not a valid ${label}. Use ${allowed.join(', ')}`)
  }
}

function assertMatchValue(operator: BankRuleMatchOperator, value: string): void {
  if (!BANK_RULE_MATCH_OPERATORS.includes(operator)) {
    throw new BadRequestError(
      `"${operator}" is not a match operator. Use ${BANK_RULE_MATCH_OPERATORS.join(', ')}`
    )
  }
  if (!value?.trim()) throw new BadRequestError('A bank rule needs a match value')
  if (operator === 'regex' && !isSafeRegexPattern(value.trim())) {
    throw new BadRequestError(
      'This pattern is too long or has a nested quantifier that could hang on a real bank ' +
        'line (e.g. "(a+)+"). Simplify it or use "contains" instead.'
    )
  }
}

function assertActionPayload(
  action: BankRuleAction,
  glAccountCode: string | null | undefined,
  counterpartBankAccountId: string | null | undefined
): void {
  if (!BANK_RULE_ACTIONS.includes(action)) {
    throw new BadRequestError(`"${action}" is not an action. Use ${BANK_RULE_ACTIONS.join(', ')}`)
  }
  if (action === 'code' && !glAccountCode?.trim()) {
    throw new BadRequestError('A code rule needs a GL account')
  }
  if (action === 'transfer' && !counterpartBankAccountId) {
    throw new BadRequestError('A transfer rule needs a counterpart bank account')
  }
}
