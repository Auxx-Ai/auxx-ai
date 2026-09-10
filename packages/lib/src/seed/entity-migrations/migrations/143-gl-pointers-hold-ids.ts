// packages/lib/src/seed/entity-migrations/migrations/143-gl-pointers-hold-ids.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:143')

/** The def the chart lives on, and the field its code is stored in. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'
const GL_ACCOUNT_CODE_ATTRIBUTE = 'gl_account_code'

/**
 * The six registry pointers converted together, one representation
 * (`plans/accounting/tasks/15-the-account-id-is-the-identity.md` §4, DECIDED
 * 2026-09-09). `stock_movement.glAccount` stores a `G8` ROLE, not a code
 * (`stock-movement-fields.ts:333-360`), and is deliberately absent.
 */
export const TARGET_FIELDS: ReadonlyArray<{ entityType: string; systemAttribute: string }> = [
  { entityType: 'bank_account', systemAttribute: 'bank_account_gl_account' },
  { entityType: 'bank_rule', systemAttribute: 'bank_rule_gl_account' },
  { entityType: 'bank_transaction', systemAttribute: 'bank_transaction_gl_account' },
  { entityType: 'bank_transaction', systemAttribute: 'bank_transaction_suggested_gl_account' },
  { entityType: 'vendor_bill_line', systemAttribute: 'vendor_bill_line_gl_account' },
  // The frozen GL code a deposit posted to. Becomes the frozen id.
  { entityType: 'bank_deposit', systemAttribute: 'bank_deposit_bank_account' },
] as const

/** One target field, resolved to its id for this org. */
interface ResolvedTarget {
  systemAttribute: string
  fieldId: string
}

/** Per-field counters this migration reports, never a per-row loop. */
interface FieldOutcome {
  converted: number
  nulled: number
  alreadyIds: number
}

/** One `FieldValue` row, as narrow as the partition step needs it. */
interface PointerRow {
  id: string
  fieldId: string
  entityId: string
  valueText: string | null
}

const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 143: the six registry GL pointers hold the `gl_account`
 * EntityInstance id, as TEXT, instead of an account CODE
 * (`plans/accounting/tasks/15-the-account-id-is-the-identity.md` §4).
 *
 * ## What it does, per field, per org
 *
 * For every stored value on one of {@link TARGET_FIELDS}:
 *
 * - Already looks like an id (equals a `gl_account` instance id in the SAME
 *   org, any archived status) → left alone. This is what makes a second run
 *   a no-op.
 * - Equals the `gl_account_code` of EXACTLY ONE live (non-archived) account in
 *   the same org → rewritten to that account's instance id.
 * - Anything else - no match, or an ambiguous code shared by more than one
 *   account - is set NULL and counted. Every org's chart was wiped by
 *   migration 142 before this lands (HANDOFF §25.6), so on the database this
 *   ships against, that is expected to be every row today: there is no live
 *   `gl_account` to resolve a code against yet, and a value that cannot be
 *   proven to be the right account is not guessed at.
 *
 * `stock_movement.glAccount` stores a `G8` ROLE, not a code
 * (`stock-movement-fields.ts:333-360`), and is not in {@link TARGET_FIELDS} -
 * brief 15 §0.5 was wrong to list it and the DECIDED block at the top of task
 * 15 says so.
 *
 * ## Bulk, never a per-row loop
 *
 * One SELECT reads every `gl_account` instance in the org (bounded by chart
 * size), and one SELECT reads every non-null value across the chart's code
 * field AND every target field present on this org, in a single
 * `fieldId IN (...)` - never one round trip per field, let alone per row.
 * Matching a code to an account, spotting an already-converted id, and
 * grouping rows onto one of a handful of target accounts all happen in
 * memory. The writes that follow are one `UPDATE ... WHERE id IN (...)` per
 * distinct target account plus one for every row being nulled, per field: at
 * most a few statements total, however many thousand `bank_transaction` rows
 * point at one of these fields.
 *
 * ## Self-sufficient and idempotent
 *
 * No resolution step depends on `postings/chart-accounts.ts` or any other
 * runtime reader - the decode here is deliberately its own, narrow copy
 * (`gl_account_code`, non-archived, this org only), because a migration must
 * still make sense years after the reader it might have shared has changed.
 * A second run finds every remaining value already an id (skipped) or already
 * null (nothing to touch) and reports `alreadyUpToDate`.
 */
export const migration143GlPointersHoldIds: EntityMigration = {
  id: '143-gl-pointers-hold-ids',
  description:
    'Converts the six bank/purchasing registry fields that named a gl_account by CODE ' +
    '(bank_account.glAccount, bank_rule.glAccount, bank_transaction.glAccount/' +
    'suggestedGlAccount, vendor_bill_line.glAccount, bank_deposit.bankAccountCode) to hold ' +
    'the gl_account instance id instead, matching GlRoleAssignment.glAccountId and ' +
    'GlPostingLine.glAccountId (plans/accounting/tasks/15-the-account-id-is-the-identity.md §4)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const glAccountDef = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)
    const codeField = glAccountDef
      ? existing.fields.get(fieldKey(glAccountDef.id, GL_ACCOUNT_CODE_ATTRIBUTE))
      : undefined

    const targets: ResolvedTarget[] = []
    for (const { entityType, systemAttribute } of TARGET_FIELDS) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue // org has not reached the entity type yet
      const field = existing.fields.get(fieldKey(def.id, systemAttribute))
      if (!field) continue // field does not exist yet on this org
      targets.push({ systemAttribute, fieldId: field.id })
    }

    if (targets.length === 0) {
      return { ...state, alreadyUpToDate: true }
    }

    // Every gl_account instance in this org, live or archived. `allAccountIds`
    // (any status) is the "already looks like an id" set - an id converted by
    // an earlier run must stay put even if the account it names has since
    // been archived. `liveAccountIds` scopes CODE resolution: only a live
    // account's code is trusted to name it.
    const instances = glAccountDef ? await readInstances(db, organizationId, glAccountDef.id) : []
    const allAccountIds = new Set(instances.map((row) => row.id))
    const liveAccountIds = new Set(
      instances.filter((row) => row.archivedAt == null).map((row) => row.id)
    )

    // One read for the chart's codes and every target field's values together.
    const fieldIds = [...(codeField ? [codeField.id] : []), ...targets.map((t) => t.fieldId)]
    const rows = await readFieldValues(db, organizationId, fieldIds)

    const codeToLiveIds = codeField
      ? buildCodeIndex(rows, codeField.id, liveAccountIds)
      : new Map<string, string[]>()

    const outcomes: Record<string, FieldOutcome> = {}
    let totalConverted = 0
    let totalNulled = 0
    let totalAlreadyIds = 0

    for (const target of targets) {
      const targetRows = rows.filter((row) => row.fieldId === target.fieldId)
      const outcome = await applyConversion(
        db,
        organizationId,
        targetRows,
        codeToLiveIds,
        allAccountIds
      )
      outcomes[target.systemAttribute] = outcome
      totalConverted += outcome.converted
      totalNulled += outcome.nulled
      totalAlreadyIds += outcome.alreadyIds
    }

    const alreadyUpToDate = totalConverted === 0 && totalNulled === 0

    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 143 applied', {
        organizationId,
        converted: totalConverted,
        nulled: totalNulled,
        alreadyIds: totalAlreadyIds,
        byField: outcomes,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}

/** Every `EntityInstance` under one entity definition, in this org - id and archived status. */
export async function readInstances(
  db: Database,
  organizationId: string,
  entityDefinitionId: string
): Promise<{ id: string; archivedAt: Date | null }[]> {
  return db
    .select({ id: schema.EntityInstance.id, archivedAt: schema.EntityInstance.archivedAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
      )
    )
}

/**
 * Every non-null value on any of `fieldIds`, in this org - the chart's own
 * code field and every present target field, in ONE round trip.
 */
export async function readFieldValues(
  db: Database,
  organizationId: string,
  fieldIds: string[]
): Promise<PointerRow[]> {
  if (fieldIds.length === 0) return []
  const rows = await db
    .select({
      id: schema.FieldValue.id,
      fieldId: schema.FieldValue.fieldId,
      entityId: schema.FieldValue.entityId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )
  return rows.filter((row) => row.valueText != null)
}

/**
 * `code -> [instance ids]` for every LIVE (non-archived) `gl_account` in this
 * org that carries one. More than one id for a code means the chart itself is
 * ambiguous - resolution refuses it rather than guessing. Pure - no db.
 */
export function buildCodeIndex(
  rows: readonly PointerRow[],
  codeFieldId: string,
  liveAccountIds: ReadonlySet<string>
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const row of rows) {
    if (row.fieldId !== codeFieldId) continue
    if (!row.valueText) continue
    if (!liveAccountIds.has(row.entityId)) continue
    const list = map.get(row.valueText) ?? []
    list.push(row.entityId)
    map.set(row.valueText, list)
  }
  return map
}

/**
 * Convert (or null) one field's already-fetched rows, in this org.
 *
 * The partition is pure JS ({@link partitionPointerValues}); the writes that
 * follow are one `UPDATE ... WHERE id IN (...)` per distinct target account
 * and one for every row being nulled - never one statement per row.
 */
export async function applyConversion(
  db: Database,
  organizationId: string,
  rows: readonly PointerRow[],
  codeToLiveIds: Map<string, string[]>,
  allAccountIds: Set<string>
): Promise<FieldOutcome> {
  if (rows.length === 0) return { converted: 0, nulled: 0, alreadyIds: 0 }

  const { convertGroups, toNullIds, alreadyIds } = partitionPointerValues(
    rows,
    codeToLiveIds,
    allAccountIds
  )

  let converted = 0
  const now = new Date()
  for (const [targetAccountId, rowIds] of convertGroups) {
    await db
      .update(schema.FieldValue)
      .set({ valueText: targetAccountId, updatedAt: now })
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.id, rowIds)
        )
      )
    converted += rowIds.length
  }

  if (toNullIds.length > 0) {
    await db
      .update(schema.FieldValue)
      .set({ valueText: null, updatedAt: now })
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.id, toNullIds)
        )
      )
  }

  return { converted, nulled: toNullIds.length, alreadyIds }
}

/**
 * Pure: sort every row into "already an id" (untouched), "convert to this
 * account id" (grouped, one bulk UPDATE per group), or "null" (no match, or
 * an ambiguous code). No db, no clock - fully testable without a database.
 */
export function partitionPointerValues(
  rows: readonly { id: string; valueText: string | null }[],
  codeToLiveIds: Map<string, string[]>,
  allAccountIds: Set<string>
): { convertGroups: Map<string, string[]>; toNullIds: string[]; alreadyIds: number } {
  const convertGroups = new Map<string, string[]>()
  const toNullIds: string[] = []
  let alreadyIds = 0

  for (const row of rows) {
    const value = row.valueText
    if (!value) continue // readFieldValues already filters this server-side; defensive here
    if (allAccountIds.has(value)) {
      alreadyIds++
      continue
    }
    const matches = codeToLiveIds.get(value)
    if (matches && matches.length === 1) {
      const targetAccountId = matches[0]!
      const group = convertGroups.get(targetAccountId) ?? []
      group.push(row.id)
      convertGroups.set(targetAccountId, group)
    } else {
      toNullIds.push(row.id)
    }
  }

  return { convertGroups, toNullIds, alreadyIds }
}
