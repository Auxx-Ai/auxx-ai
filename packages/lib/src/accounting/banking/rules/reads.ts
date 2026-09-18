// packages/lib/src/accounting/banking/rules/reads.ts

/**
 * Every READ over `bank_rule` and the `bank_transaction` slice
 * `suggestFromHistory` and `evaluateRules` need (HANDOFF slot 3C).
 *
 * Reads only. The writes live in `writes.ts`
 * (`docs/lib-module-guide.md` §5). No permission checks - the router asserts
 * `ledgerView` or `ledgerPost` (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { toDateKey } from '@auxx/utils/calendar-day'
import { and, eq, ilike, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { readSystemRecords, type SystemRecord } from '../../../resources/system-records'
import { daysBetween } from '../client'
import {
  type BankRuleAttribute,
  type BankRuleFieldContext,
  loadBankRuleFieldContext,
  loadRuleTransactionFieldContext,
  type RuleTransactionFieldContext,
} from '../fields'
import {
  type BankRuleAction,
  type BankRuleConditions,
  type BankRuleDirection,
  type BankRuleMatchField,
  type BankRuleMatchOperator,
  type BankRuleRecord,
  HISTORY_SAMPLE_SIZE,
  TRANSFER_MATCH_WINDOW_DAYS,
} from './client'
import { matchesRuleConditions } from './evaluate'
import { guard } from './guard'

/** One rule by id, or `null` when it does not exist, is archived, or is another org's. */
export async function getBankRule(
  db: Database,
  params: { organizationId: string; ruleId: string }
): Promise<Result<BankRuleRecord | null, Error>> {
  const { organizationId, ruleId } = params
  return guard(
    async () => {
      const ctx = await loadBankRuleFieldContext(db, organizationId)
      if (!ctx) return null

      const records = await readSystemRecords(db, organizationId, ctx, { ids: [ruleId] })
      const [row] = hydrateRules(records)
      return row ?? null
    },
    'Failed to read bank rule',
    { organizationId, ruleId }
  )
}

/** Every rule in the org, priority ascending then oldest first - `evaluateRules`' own order. */
export async function listBankRules(
  db: Database,
  params: { organizationId: string; enabledOnly?: boolean }
): Promise<Result<BankRuleRecord[], Error>> {
  const { organizationId, enabledOnly } = params
  return guard(
    async () => {
      const ctx = await loadBankRuleFieldContext(db, organizationId)
      if (!ctx) return []

      const rows = hydrateRules(await readSystemRecords(db, organizationId, ctx, {}))
      const filtered = enabledOnly ? rows.filter((row) => row.enabled) : rows
      return [...filtered].sort((a, b) => (a.priority || 0) - (b.priority || 0))
    },
    'Failed to list bank rules',
    { organizationId }
  )
}

function hydrateRules(records: SystemRecord<BankRuleAttribute>[]): BankRuleRecord[] {
  return records.map((record) => ({
    id: record.id,
    recordId: record.recordId,
    name: record.text('bank_rule_name') ?? '',
    enabled: record.boolean('bank_rule_enabled') ?? true,
    autoApply: record.boolean('bank_rule_auto_apply') ?? false,
    priority: record.number('bank_rule_priority') ?? 0,
    matchField: (record.option('bank_rule_match_field') ?? 'matchKey') as BankRuleMatchField,
    matchOperator: (record.option('bank_rule_match_operator') ??
      'contains') as BankRuleMatchOperator,
    matchValue: record.text('bank_rule_match_value') ?? '',
    amountMinMinor: roundOrNull(record.number('bank_rule_amount_min')),
    amountMaxMinor: roundOrNull(record.number('bank_rule_amount_max')),
    direction: (record.option('bank_rule_direction') ?? 'any') as BankRuleDirection,
    bankAccountId: record.text('bank_rule_bank_account'),
    action: (record.option('bank_rule_action') ?? 'code') as BankRuleAction,
    glAccountId: record.text('bank_rule_gl_account'),
    counterpartBankAccountId: record.text('bank_rule_counterpart_bank_account'),
    contactId: record.text('bank_rule_contact'),
    memo: record.text('bank_rule_memo'),
    appliedCount: record.number('bank_rule_applied_count') ?? 0,
    lastAppliedAt: toDateOrNull(record.date('bank_rule_last_applied_at')),
    createdAt: record.createdAt,
  }))
}

function roundOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value)
}

function toDateOrNull(value: string | null | undefined): string | null {
  return value ? toDateKey(value) : null
}

// ─── bank_transaction slice for matching ─────────────────────────────────

/** What `evaluateRules`, `suggestFromHistory` and `applySuggestions` need from one line. */
export interface TransactionMatchRow {
  id: string
  bankAccountId: string | null
  postedAt: string | null
  description: string | null
  matchKey: string | null
  /** Integer minor units, signed. */
  amountMinor: number
  reviewStatus: string | null
  glAccountId: string | null
}

/** One transaction's matching-relevant fields, or `null` when it does not exist. */
export async function getTransactionMatchRow(
  db: Database,
  params: { organizationId: string; transactionId: string }
): Promise<Result<TransactionMatchRow | null, Error>> {
  const { organizationId, transactionId } = params
  return guard(
    async () => {
      const ctx = await loadRuleTransactionFieldContext(db, organizationId)
      if (!ctx) return null
      const rows = await readTxMatchRows(db, organizationId, ctx, [transactionId])
      return rows[0] ?? null
    },
    'Failed to read bank transaction for matching',
    { organizationId, transactionId }
  )
}

/** Every `for_review` transaction id, optionally scoped to one account. Oldest first. */
export async function listForReviewTransactionIds(
  db: Database,
  params: { organizationId: string; bankAccountId?: string }
): Promise<Result<string[], Error>> {
  const { organizationId, bankAccountId } = params
  return guard(
    async () => {
      const ctx = await loadRuleTransactionFieldContext(db, organizationId)
      const statusField = ctx?.fields.bank_transaction_review_status
      if (!ctx || !statusField) return []

      const statusRows = await db
        .select({ entityId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, statusField.id),
            eq(schema.FieldValue.optionId, 'for_review')
          )
        )
      let ids = [...new Set(statusRows.map((row) => row.entityId))]
      if (ids.length === 0) return []

      const acctField = ctx.fields.bank_transaction_bank_account
      if (bankAccountId && acctField) {
        const acctRows = await db
          .select({ entityId: schema.FieldValue.entityId })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.fieldId, acctField.id),
              eq(schema.FieldValue.relatedEntityId, bankAccountId),
              inArray(schema.FieldValue.entityId, ids)
            )
          )
        const acctIds = new Set(acctRows.map((row) => row.entityId))
        ids = ids.filter((id) => acctIds.has(id))
      }
      const live = await readSystemRecords(db, organizationId, ctx, { ids, cells: false })
      const liveIds = new Set(live.map((record) => record.id))
      return ids.filter((id) => liveIds.has(id))
    },
    'Failed to list for-review transactions',
    { organizationId, bankAccountId }
  )
}

/**
 * The last {@link HISTORY_SAMPLE_SIZE} `coded` or `matched` lines with the same
 * `matchKey` on the same account, newest first, excluding the line itself.
 *
 * Three narrowing queries intersected in memory rather than one join per
 * attribute - the `readTransactionDateKeys` precedent in `banking/reads.ts`.
 * The candidate set for one org's one match key is small; this is not the
 * query that needs to scale to millions of rows.
 */
export async function listHistoryMatches(
  db: Database,
  params: {
    organizationId: string
    bankAccountId: string
    matchKey: string
    excludeTransactionId: string
  }
): Promise<Result<{ glAccountId: string | null; postedAt: string | null }[], Error>> {
  const { organizationId, bankAccountId, matchKey, excludeTransactionId } = params
  return guard(
    async () => {
      const ctx = await loadRuleTransactionFieldContext(db, organizationId)
      const matchKeyField = ctx?.fields.bank_transaction_match_key
      const acctField = ctx?.fields.bank_transaction_bank_account
      const statusField = ctx?.fields.bank_transaction_review_status
      if (!ctx || !matchKeyField || !acctField || !statusField) return []

      const [keyRows, acctRows, statusRows] = await Promise.all([
        db
          .select({ entityId: schema.FieldValue.entityId })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.fieldId, matchKeyField.id),
              eq(schema.FieldValue.valueText, matchKey)
            )
          ),
        db
          .select({ entityId: schema.FieldValue.entityId })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.fieldId, acctField.id),
              eq(schema.FieldValue.relatedEntityId, bankAccountId)
            )
          ),
        db
          .select({ entityId: schema.FieldValue.entityId })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.fieldId, statusField.id),
              inArray(schema.FieldValue.optionId, ['coded', 'matched'])
            )
          ),
      ])

      const keyIds = new Set(keyRows.map((row) => row.entityId))
      const acctIds = new Set(acctRows.map((row) => row.entityId))
      const candidateIds = [...new Set(statusRows.map((row) => row.entityId))].filter(
        (id) => id !== excludeTransactionId && keyIds.has(id) && acctIds.has(id)
      )
      if (candidateIds.length === 0) return []

      const rows = await readTxMatchRows(db, organizationId, ctx, candidateIds)
      return rows
        .filter((row): row is TransactionMatchRow & { postedAt: string } => row.postedAt != null)
        .sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0))
        .slice(0, HISTORY_SAMPLE_SIZE)
        .map((row) => ({ glAccountId: row.glAccountId, postedAt: row.postedAt }))
    },
    'Failed to read bank transaction history',
    { organizationId, bankAccountId, matchKey }
  )
}

/**
 * The opposite leg of a transfer: a line on a DIFFERENT account whose amount
 * is the exact negation of `amountMinor`, dated within
 * {@link TRANSFER_MATCH_WINDOW_DAYS} of `postedAt`.
 *
 * Returns the closest-dated candidate. `null` when none exists - most
 * transactions are not transfers, and that is the common case this answers
 * quickly.
 */
export async function findTransferCandidate(
  db: Database,
  params: {
    organizationId: string
    excludeTransactionId: string
    excludeBankAccountId: string | null
    amountMinor: number
    postedAt: string | null
  }
): Promise<Result<{ id: string; bankAccountId: string } | null, Error>> {
  const { organizationId, excludeTransactionId, excludeBankAccountId, amountMinor, postedAt } =
    params
  return guard(
    async () => {
      if (!postedAt) return null
      const ctx = await loadRuleTransactionFieldContext(db, organizationId)
      const amountField = ctx?.fields.bank_transaction_amount
      if (!ctx || !amountField) return null

      const amountRows = await db
        .select({ entityId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, amountField.id),
            eq(schema.FieldValue.valueNumber, -amountMinor)
          )
        )
      const candidateIds = amountRows
        .map((row) => row.entityId)
        .filter((id) => id !== excludeTransactionId)
      if (candidateIds.length === 0) return null

      const rows = await readTxMatchRows(db, organizationId, ctx, candidateIds)
      const inWindow = rows
        .filter((row) => row.bankAccountId && row.bankAccountId !== excludeBankAccountId)
        .filter(
          (row) =>
            row.postedAt &&
            Math.abs(daysBetween(postedAt, row.postedAt)) <= TRANSFER_MATCH_WINDOW_DAYS
        )
        .sort(
          (a, b) =>
            Math.abs(daysBetween(postedAt, a.postedAt as string)) -
            Math.abs(daysBetween(postedAt, b.postedAt as string))
        )

      const best = inWindow[0]
      return best ? { id: best.id, bankAccountId: best.bankAccountId as string } : null
    },
    'Failed to find transfer candidate',
    { organizationId, excludeTransactionId, amountMinor }
  )
}

/**
 * Turn a page of `bank_transaction` ids into {@link TransactionMatchRow}s, in
 * the order given.
 *
 * 🛑 The reader drops an ARCHIVED instance, and that filter is load-bearing.
 * Every transaction read in this file starts from `FieldValue`, and a
 * `FieldValue` row outlives an archive - archiving a bank account archives its
 * lines but leaves their values in place. Without it a removed account's lines
 * still arrive as review candidates, history samples and transfer legs, and
 * `crud.update` then refuses them with `Entity not found` (it reads through
 * `getEntityInstanceRow`, which is `archivedAt IS NULL`).
 */
async function readTxMatchRows(
  db: Database,
  organizationId: string,
  ctx: RuleTransactionFieldContext,
  ids: string[]
): Promise<TransactionMatchRow[]> {
  if (ids.length === 0) return []
  const records = await readSystemRecords(db, organizationId, ctx, { ids })
  const byId = new Map(records.map((record) => [record.id, record]))

  const out: TransactionMatchRow[] = []
  for (const id of ids) {
    const record = byId.get(id)
    if (!record) continue
    out.push({
      id,
      bankAccountId: record.related('bank_transaction_bank_account'),
      postedAt: toDateOrNull(record.date('bank_transaction_posted_at')),
      description: record.text('bank_transaction_description'),
      matchKey: record.text('bank_transaction_match_key'),
      amountMinor: Math.round(record.number('bank_transaction_amount') ?? 0),
      reviewStatus: record.option('bank_transaction_review_status'),
      glAccountId: record.text('bank_transaction_gl_account'),
    })
  }
  return out
}

// ─── pattern preview ─────────────────────────────────────────────────────

/**
 * The most `bank_transaction` rows one preview will hydrate.
 *
 * A preview is a person typing into a box, so it has to answer fast and it has
 * to answer honestly when it cannot see the whole book. The cap is on the
 * CANDIDATE set, and {@link RulePatternPreview.truncated} says when it bit -
 * silently counting 5,000 of 12,000 would be a confident wrong number, which is
 * the one thing this feature must not produce.
 */
const MAX_PREVIEW_CANDIDATES = 5_000

/** How many example lines a preview returns. Enough to recognise a mistake. */
const PREVIEW_SAMPLE_SIZE = 12

/** One line in a preview's sample. */
export interface RulePatternPreviewLine {
  id: string
  postedAt: string | null
  description: string | null
  matchKey: string | null
  amountMinor: number
  reviewStatus: string | null
  glAccountId: string | null
}

export interface RulePatternPreview {
  /** How many lines in the org the conditions match. */
  matchCount: number
  /** Of those, how many are already `coded`. */
  codedCount: number
  /**
   * How the already-coded matches were coded, commonest first. This is the
   * rule-mining signal: "31 lines match, 27 of them are already 6100" is the
   * evidence that the rule is worth writing.
   */
  codedByAccount: { glAccountId: string; count: number }[]
  /** Newest first, capped at {@link PREVIEW_SAMPLE_SIZE}. */
  sample: RulePatternPreviewLine[]
  /** `true` when the candidate set hit {@link MAX_PREVIEW_CANDIDATES}. */
  truncated: boolean
}

/**
 * Count and sample the lines a set of rule conditions would match, without
 * creating a rule.
 *
 * 🛑 **The final filter is {@link matchesRuleConditions}, in JavaScript, for
 * every operator** - the same function `evaluateRules` runs at ingest. SQL is
 * used only to NARROW, and only where it can do so as a strict superset:
 *
 * - `contains` / `equals` / `starts_with` narrow with `ILIKE` on the matched
 *   field, with the user's `%` and `_` escaped so a pasted pattern cannot turn
 *   itself into a wildcard.
 * - `regex` cannot narrow at all. Postgres `~*` is POSIX - no lookarounds, and
 *   different escaping - so a `~*` pre-filter would drop rows the JavaScript
 *   pattern matches. It scans the def instead, bounded by
 *   {@link MAX_PREVIEW_CANDIDATES}.
 *
 * ⚠️ This is a deliberate exception to the review queue's "every filter runs in
 * SQL" rule, and the reason is that agreeing with ingest matters more here than
 * the roundtrip does. Do not "optimise" the regex branch into `~*`.
 */
export async function previewRulePattern(
  db: Database,
  params: { organizationId: string; conditions: BankRuleConditions }
): Promise<Result<RulePatternPreview, Error>> {
  const { organizationId, conditions } = params
  return guard(
    async () => {
      const empty: RulePatternPreview = {
        matchCount: 0,
        codedCount: 0,
        codedByAccount: [],
        sample: [],
        truncated: false,
      }
      if (!conditions.matchValue.trim()) return empty

      const ctx = await loadRuleTransactionFieldContext(db, organizationId)
      if (!ctx) return empty
      const fieldAttribute =
        conditions.matchField === 'description'
          ? 'bank_transaction_description'
          : 'bank_transaction_match_key'
      const matchedField = ctx.fields[fieldAttribute]
      if (!matchedField) return empty

      const candidateRows = await db
        .select({ entityId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, matchedField.id),
            ...narrowByOperator(conditions)
          )
        )
        .limit(MAX_PREVIEW_CANDIDATES + 1)

      const truncated = candidateRows.length > MAX_PREVIEW_CANDIDATES
      const candidateIds = candidateRows.slice(0, MAX_PREVIEW_CANDIDATES).map((row) => row.entityId)
      if (candidateIds.length === 0) return empty

      const rows = await readTxMatchRows(db, organizationId, ctx, candidateIds)
      const matched = rows.filter((row) => matchesRuleConditions(conditions, row))

      const byAccount = new Map<string, number>()
      for (const row of matched) {
        if (row.reviewStatus !== 'coded' || !row.glAccountId) continue
        byAccount.set(row.glAccountId, (byAccount.get(row.glAccountId) ?? 0) + 1)
      }

      // `postedAt` is a `YYYY-MM-DD` day key, so a string compare IS the date
      // order. A line the bank never dated sorts last rather than first.
      const sample = [...matched]
        .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
        .slice(0, PREVIEW_SAMPLE_SIZE)
        .map((row) => ({
          id: row.id,
          postedAt: row.postedAt,
          description: row.description,
          matchKey: row.matchKey,
          amountMinor: row.amountMinor,
          reviewStatus: row.reviewStatus,
          glAccountId: row.glAccountId,
        }))

      return {
        matchCount: matched.length,
        codedCount: [...byAccount.values()].reduce((total, count) => total + count, 0),
        codedByAccount: [...byAccount.entries()]
          .map(([glAccountId, count]) => ({ glAccountId, count }))
          .sort((a, b) => b.count - a.count),
        sample,
        truncated,
      }
    },
    'Failed to preview a bank rule pattern',
    { organizationId, matchField: conditions.matchField, matchOperator: conditions.matchOperator }
  )
}

/**
 * The SQL half of the preview: a strict SUPERSET of what
 * {@link matchesRuleConditions} will accept, or nothing at all for `regex`.
 */
function narrowByOperator(conditions: BankRuleConditions) {
  const escaped = escapeLikePattern(conditions.matchValue)
  switch (conditions.matchOperator) {
    case 'contains':
      return [ilike(schema.FieldValue.valueText, `%${escaped}%`)]
    case 'equals':
      return [ilike(schema.FieldValue.valueText, escaped)]
    case 'starts_with':
      return [ilike(schema.FieldValue.valueText, `${escaped}%`)]
    default:
      return []
  }
}

/**
 * Neutralise `LIKE`'s own metacharacters in a user-typed value.
 *
 * Without this, a pattern containing `%` matches far more than the person meant
 * and the preview's count is larger than what the rule will ever do - the exact
 * shape of lie this feature exists to avoid. The backslash is doubled first, or
 * escaping `%` would leave a dangling escape of its own.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, (char) => `\\${char}`)
}
