// packages/lib/src/banking/rules/reads.ts

/**
 * Every READ over `bank_rule` and the `bank_transaction` slice
 * `suggestFromHistory` and `evaluateRules` need (HANDOFF slot 3C).
 *
 * Reads only. The writes live in `writes.ts`
 * (`docs/lib-module-guide.md` §5). No permission checks - the router asserts
 * `ledgerView` or `ledgerPost` (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, ilike, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { toRecordId } from '../../resources/resource-id'
import { daysBetween, toDateKey } from '../client'
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

// ─── bank_rule field context ─────────────────────────────────────────────

const BANK_RULE_ATTRIBUTES = [
  'bank_rule_name',
  'bank_rule_enabled',
  'bank_rule_auto_apply',
  'bank_rule_priority',
  'bank_rule_match_field',
  'bank_rule_match_operator',
  'bank_rule_match_value',
  'bank_rule_amount_min',
  'bank_rule_amount_max',
  'bank_rule_direction',
  'bank_rule_bank_account',
  'bank_rule_action',
  'bank_rule_gl_account',
  'bank_rule_counterpart_bank_account',
  'bank_rule_contact',
  'bank_rule_memo',
  'bank_rule_applied_count',
  'bank_rule_last_applied_at',
] as const

type BankRuleAttribute = (typeof BANK_RULE_ATTRIBUTES)[number]
type BankRuleFields = Record<BankRuleAttribute, { id: string } | null>

/** The resolved def and field ids every `bank_rule` read and write needs. */
export interface BankRuleFieldContext {
  bankRuleDefId: string
  fields: BankRuleFields
}

/** `null` when the org has not run migration 125 yet. */
export async function loadBankRuleFieldContext(
  organizationId: string
): Promise<BankRuleFieldContext | null> {
  const bankRuleDefId = await getCachedEntityDefId(organizationId, 'bank_rule')
  if (!bankRuleDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...BANK_RULE_ATTRIBUTES])) as BankRuleFields
  if (!fields.bank_rule_name || !fields.bank_rule_enabled) return null
  return { bankRuleDefId, fields }
}

/** {@link loadBankRuleFieldContext}, as the refusal a write path needs. */
export async function requireBankRuleFieldContext(
  organizationId: string
): Promise<BankRuleFieldContext> {
  const ctx = await loadBankRuleFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank rules are not available until the bank_rule entity is provisioned (entity ' +
        'migration 125)'
    )
  }
  return ctx
}

/** One rule by id, or `null` when it does not exist, is archived, or is another org's. */
export async function getBankRule(
  db: Database,
  params: { organizationId: string; ruleId: string }
): Promise<Result<BankRuleRecord | null, Error>> {
  const { organizationId, ruleId } = params
  return guard(
    async () => {
      const ctx = await loadBankRuleFieldContext(organizationId)
      if (!ctx) return null

      const [instance] = await db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, ruleId),
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.bankRuleDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .limit(1)

      if (!instance) return null
      const [row] = await hydrateRules(db, organizationId, ctx, [instance])
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
      const ctx = await loadBankRuleFieldContext(organizationId)
      if (!ctx) return []

      const instances = await db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.bankRuleDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .orderBy(asc(schema.EntityInstance.createdAt))

      if (instances.length === 0) return []
      const rows = await hydrateRules(db, organizationId, ctx, instances)
      const filtered = enabledOnly ? rows.filter((row) => row.enabled) : rows
      return [...filtered].sort((a, b) => (a.priority || 0) - (b.priority || 0))
    },
    'Failed to list bank rules',
    { organizationId }
  )
}

async function hydrateRules(
  db: Database,
  organizationId: string,
  ctx: BankRuleFieldContext,
  page: { id: string; createdAt: Date | null }[]
): Promise<BankRuleRecord[]> {
  const ids = page.map((row) => row.id)
  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = fieldIds.length
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueText: schema.FieldValue.valueText,
          valueNumber: schema.FieldValue.valueNumber,
          valueBoolean: schema.FieldValue.valueBoolean,
          valueDate: schema.FieldValue.valueDate,
          optionId: schema.FieldValue.optionId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, ids),
            inArray(schema.FieldValue.fieldId, fieldIds)
          )
        )
    : []

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const read = (instanceId: string, attr: BankRuleAttribute) => {
    const id = ctx.fields[attr]?.id
    return id ? (byInstance.get(instanceId)?.get(id) ?? null) : null
  }

  return page.map((row) => ({
    id: row.id,
    recordId: toRecordId(ctx.bankRuleDefId, row.id),
    name: read(row.id, 'bank_rule_name')?.valueText ?? '',
    enabled: read(row.id, 'bank_rule_enabled')?.valueBoolean ?? true,
    autoApply: read(row.id, 'bank_rule_auto_apply')?.valueBoolean ?? false,
    priority: read(row.id, 'bank_rule_priority')?.valueNumber ?? 0,
    matchField: (read(row.id, 'bank_rule_match_field')?.optionId ??
      'matchKey') as BankRuleMatchField,
    matchOperator: (read(row.id, 'bank_rule_match_operator')?.optionId ??
      'contains') as BankRuleMatchOperator,
    matchValue: read(row.id, 'bank_rule_match_value')?.valueText ?? '',
    amountMinMinor: roundOrNull(read(row.id, 'bank_rule_amount_min')?.valueNumber),
    amountMaxMinor: roundOrNull(read(row.id, 'bank_rule_amount_max')?.valueNumber),
    direction: (read(row.id, 'bank_rule_direction')?.optionId ?? 'any') as BankRuleDirection,
    bankAccountId: read(row.id, 'bank_rule_bank_account')?.valueText ?? null,
    action: (read(row.id, 'bank_rule_action')?.optionId ?? 'code') as BankRuleAction,
    glAccountId: read(row.id, 'bank_rule_gl_account')?.valueText ?? null,
    counterpartBankAccountId: read(row.id, 'bank_rule_counterpart_bank_account')?.valueText ?? null,
    contactId: read(row.id, 'bank_rule_contact')?.valueText ?? null,
    memo: read(row.id, 'bank_rule_memo')?.valueText ?? null,
    appliedCount: read(row.id, 'bank_rule_applied_count')?.valueNumber ?? 0,
    lastAppliedAt: toDateOrNull(read(row.id, 'bank_rule_last_applied_at')?.valueDate),
    createdAt: row.createdAt,
  }))
}

function roundOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value)
}

function toDateOrNull(value: string | null | undefined): string | null {
  return value ? toDateKey(value) : null
}

// ─── bank_transaction slice for matching ─────────────────────────────────

const TX_MATCH_ATTRIBUTES = [
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
  'bank_transaction_match_key',
  'bank_transaction_review_status',
  'bank_transaction_gl_account',
] as const

type TxMatchAttribute = (typeof TX_MATCH_ATTRIBUTES)[number]
type TxMatchFields = Record<TxMatchAttribute, { id: string } | null>

/** The resolved `bank_transaction` field ids `suggestFromHistory` and `applySuggestions` need. */
export interface RuleTransactionFieldContext {
  bankTransactionDefId: string
  fields: TxMatchFields
}

export async function loadRuleTransactionFieldContext(
  organizationId: string
): Promise<RuleTransactionFieldContext | null> {
  const bankTransactionDefId = await getCachedEntityDefId(organizationId, 'bank_transaction')
  if (!bankTransactionDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...TX_MATCH_ATTRIBUTES])) as TxMatchFields
  if (!fields.bank_transaction_review_status || !fields.bank_transaction_amount) return null
  return { bankTransactionDefId, fields }
}

export async function requireRuleTransactionFieldContext(
  organizationId: string
): Promise<RuleTransactionFieldContext> {
  const ctx = await loadRuleTransactionFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank transactions are not available until the bank_transaction entity is provisioned ' +
        '(entity migration 125)'
    )
  }
  return ctx
}

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
      const ctx = await loadRuleTransactionFieldContext(organizationId)
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
      const ctx = await loadRuleTransactionFieldContext(organizationId)
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
      return filterLiveTransactionIds(db, organizationId, ctx.bankTransactionDefId, ids)
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
      const ctx = await loadRuleTransactionFieldContext(organizationId)
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
      const ctx = await loadRuleTransactionFieldContext(organizationId)
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
 * Keep only the ids that are still live `bank_transaction` instances, in the
 * order given.
 *
 * 🛑 Every transaction read in this file starts from `FieldValue`, and a
 * `FieldValue` row outlives an archive - archiving a bank account archives its
 * lines but leaves their values in place. Without this filter a removed
 * account's lines still arrive as review candidates, history samples and
 * transfer legs, and `crud.update` then refuses them with `Entity not found`
 * (it reads through `getEntityInstanceRow`, which is `archivedAt IS NULL`).
 */
async function filterLiveTransactionIds(
  db: Database,
  organizationId: string,
  bankTransactionDefId: string,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, bankTransactionDefId),
        isNull(schema.EntityInstance.archivedAt),
        inArray(schema.EntityInstance.id, ids)
      )
    )
  const live = new Set(rows.map((row) => row.id))
  return ids.filter((id) => live.has(id))
}

/** Turn a page of `bank_transaction` ids into {@link TransactionMatchRow}s, one query. */
async function readTxMatchRows(
  db: Database,
  organizationId: string,
  ctx: RuleTransactionFieldContext,
  ids: string[]
): Promise<TransactionMatchRow[]> {
  const liveIds = await filterLiveTransactionIds(db, organizationId, ctx.bankTransactionDefId, ids)
  if (liveIds.length === 0) return []
  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = fieldIds.length
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueText: schema.FieldValue.valueText,
          valueNumber: schema.FieldValue.valueNumber,
          valueDate: schema.FieldValue.valueDate,
          optionId: schema.FieldValue.optionId,
          relatedEntityId: schema.FieldValue.relatedEntityId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, liveIds),
            inArray(schema.FieldValue.fieldId, fieldIds)
          )
        )
    : []

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const read = (id: string, attr: TxMatchAttribute) => {
    const fieldId = ctx.fields[attr]?.id
    return fieldId ? (byInstance.get(id)?.get(fieldId) ?? null) : null
  }

  return liveIds.map((id) => ({
    id,
    bankAccountId: read(id, 'bank_transaction_bank_account')?.relatedEntityId ?? null,
    postedAt: toDateOrNull(read(id, 'bank_transaction_posted_at')?.valueDate),
    description: read(id, 'bank_transaction_description')?.valueText ?? null,
    matchKey: read(id, 'bank_transaction_match_key')?.valueText ?? null,
    amountMinor: Math.round(read(id, 'bank_transaction_amount')?.valueNumber ?? 0),
    reviewStatus: read(id, 'bank_transaction_review_status')?.optionId ?? null,
    glAccountId: read(id, 'bank_transaction_gl_account')?.valueText ?? null,
  }))
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

      const ctx = await loadRuleTransactionFieldContext(organizationId)
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
