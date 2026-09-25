// packages/lib/src/data-migrations/migrations/193-inventory-ledger-under-mrp.ts
// The one per-org migration for brief 111 (§13). Each unit adds a named step below; every
// step is idempotent on its own and reports separately, so a retry redoes only what failed.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { dayKeyInZone } from '@auxx/utils/calendar-day'
import { nextKeyAfter } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getOrgCache } from '../../cache'
import { buildFieldValueRow } from '../../field-values/field-value-mutations'
import { StockMovementType } from '../../resources/registry/enum-values'
import type { ResourceField } from '../../resources/registry/field-types'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import { optionalFieldId, systemValueJoin } from '../../resources/system-records'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:193')

/** The direct `CustomField` write bypasses the org cache, and `up()` also runs outside the adapter. */
const CACHE_KEYS = ['customFields', 'resources'] as const

interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/** What each step did for one org; a unit's step adds its own key. */
export interface InventoryLedgerMigrationSteps {
  /** X2 Q18: the `pending` cost basis option appended. */
  costBasisPendingAdded: boolean
  /** X2 Q21: `relieve` work items moved to `price`, and any dropped behind an existing `price` row. */
  workItemsRestaged: number
  workItemsSuperseded: number
  /** X5 D23: the `backflush` build source option appended. */
  buildSourceBackflushAdded: boolean
  /** X4 Q26: the two count-fact fields created, and the existing `initial` rows stamped with their own (quantity, day). */
  countFactFieldsCreated: number
  initialsStamped: number
}

export interface InventoryLedgerMigrationResult extends PerOrgMigrationResult {
  steps: InventoryLedgerMigrationSteps
}

// ── X2 (a): `stock_movement_cost_basis` + `pending` (111 Q18) ───────────────────

const COST_BASIS_ATTRIBUTE = 'stock_movement_cost_basis'

/** A literal, not `StockMovementCostBasis`: this is what the migration writes, whatever the registry says later. */
const PENDING_OPTION = { value: 'pending', label: 'Pending', color: 'amber' }

/** `stored` with `pending` appended, or `null` when present. Pure. */
export function withPendingOption(stored: readonly StoredOption[]): StoredOption[] | null {
  if (stored.some((option) => option.value === PENDING_OPTION.value)) return null
  return [...stored, { ...PENDING_OPTION }]
}

async function addPendingCostBasisOption(db: Database, organizationId: string): Promise<boolean> {
  return appendSelectOption(db, organizationId, {
    modelType: 'stock_movement',
    systemAttribute: COST_BASIS_ATTRIBUTE,
    widen: withPendingOption,
  })
}

/** Append one option to a per-org select field; `widen` returns `null` when it is already there. */
async function appendSelectOption(
  db: Database,
  organizationId: string,
  spec: {
    modelType: string
    systemAttribute: string
    widen: (stored: readonly StoredOption[]) => StoredOption[] | null
  }
): Promise<boolean> {
  const field = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.modelType, spec.modelType),
      eq(schema.CustomField.systemAttribute, spec.systemAttribute)
    ),
    columns: { id: true, options: true },
  })
  if (!field) return false
  const stored = (field.options as { options?: StoredOption[] } | null)?.options
  if (!Array.isArray(stored)) return false
  const next = spec.widen(stored)
  if (!next) return false

  await db
    .update(schema.CustomField)
    .set({
      options: { ...(field.options as Record<string, unknown>), options: next },
      updatedAt: new Date(),
    })
    .where(eq(schema.CustomField.id, field.id))
  await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
  return true
}

// ── X2 (b): `relieve` work items park at `price` now (111 Q21) ──────────────────

/** The stage relief parked at before pending-cost documents got their own lane. */
export const RETIRED_RELIEVE_STAGE = 'relieve'
export const PRICE_STAGE = 'price'

async function restageRelieveWorkItems(
  db: Database,
  organizationId: string
): Promise<Pick<InventoryLedgerMigrationSteps, 'workItemsRestaged' | 'workItemsSuperseded'>> {
  const now = new Date()
  const w = schema.AccountingWorkItem
  // The unique key is (org, sourceKind, sourceId, occurrence, stage); a `price` row for the
  // same source would collide, so those rows are skipped and dropped below as superseded.
  const collides = sql`EXISTS (SELECT 1 FROM ${w} p
    WHERE p."organizationId" = ${w.organizationId}
      AND p."sourceKind" = ${w.sourceKind}
      AND p."sourceId" = ${w.sourceId}
      AND p."occurrence" = ${w.occurrence}
      AND p."stage" = ${PRICE_STAGE})`
  const moved = await db
    .update(w)
    .set({ stage: PRICE_STAGE, nextAttemptAt: now, updatedAt: now })
    .where(
      and(
        eq(w.organizationId, organizationId),
        eq(w.stage, RETIRED_RELIEVE_STAGE),
        sql`NOT ${collides}`
      )
    )
    .returning({ id: w.id })
  const superseded = await db
    .delete(w)
    .where(and(eq(w.organizationId, organizationId), eq(w.stage, RETIRED_RELIEVE_STAGE)))
    .returning({ id: w.id })
  return { workItemsRestaged: moved.length, workItemsSuperseded: superseded.length }
}

// ── X5 (d): `build_source` + `backflush` (111 D23) ──────────────────────────────

const BUILD_SOURCE_ATTRIBUTE = 'build_source'

/** A literal, like `PENDING_OPTION`: what the migration writes, whatever `BuildSource` says later. */
const BACKFLUSH_OPTION = { value: 'backflush', label: 'Backflush', color: 'teal' }

/** `stored` with `backflush` appended, or `null` when present. Pure. */
export function withBackflushOption(stored: readonly StoredOption[]): StoredOption[] | null {
  if (stored.some((option) => option.value === BACKFLUSH_OPTION.value)) return null
  return [...stored, { ...BACKFLUSH_OPTION }]
}

async function addBackflushBuildSourceOption(
  db: Database,
  organizationId: string
): Promise<boolean> {
  return appendSelectOption(db, organizationId, {
    modelType: 'build',
    systemAttribute: BUILD_SOURCE_ATTRIBUTE,
    widen: withBackflushOption,
  })
}

// ── X4 (c): the count fact on `initial` rows (111 Q26) ─────────────────────────

const MOVEMENT = 'stock_movement'
const COUNT_FACT_KEYS = ['countQuantity', 'countDate'] as const
const STAMP_CHUNK = 500

/** The fact an old opening re-anchors from: its own quantity, on its own (UTC) day. Pure. */
export function countFactOf(row: {
  quantity: number | null
  occurredAt: string | null
  createdAt: Date
}): { countQuantity: number; countDate: string } {
  const day = row.occurredAt ? new Date(row.occurredAt) : row.createdAt
  return {
    countQuantity: row.quantity ?? 0,
    countDate: `${dayKeyInZone(day, 'UTC')}T00:00:00.000Z`,
  }
}

async function addCountFactFields(db: Database, organizationId: string): Promise<number> {
  const existing = await loadExistingState(db, organizationId)
  const def = existing.entityDefs.get(MOVEMENT)
  if (!def) return 0
  const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
  const fields: Record<string, ResourceField> = {}
  for (const key of COUNT_FACT_KEYS) {
    const field = STOCK_MOVEMENT_FIELDS[key]
    if (!field) throw new Error(`The stock movement registry is missing ${key} (migration 193)`)
    fields[key] = field
  }
  await ensureCustomFields(db, organizationId, MOVEMENT, def.id, fields, existing, state)
  if (state.fieldsCreated > 0) {
    await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
  }
  return state.fieldsCreated
}

/** Every `initial` row without a count fact takes (quantity, day) as its own; a stamped row is left alone. */
async function stampInitialCountFacts(db: Database, organizationId: string): Promise<number> {
  const f = schema.CustomField
  const fieldRows = await db
    .select({ id: f.id, systemAttribute: f.systemAttribute })
    .from(f)
    .where(
      and(
        eq(f.organizationId, organizationId),
        eq(f.modelType, MOVEMENT),
        inArray(f.systemAttribute, [
          'stock_movement_type',
          'stock_movement_quantity',
          'stock_movement_occurred_at',
          'stock_movement_count_quantity',
          'stock_movement_count_date',
        ])
      )
    )
  const fieldId = new Map(fieldRows.map((row) => [row.systemAttribute, row.id]))
  const typeId = fieldId.get('stock_movement_type')
  const quantityId = fieldId.get('stock_movement_quantity')
  const countQuantityId = fieldId.get('stock_movement_count_quantity')
  const countDateId = fieldId.get('stock_movement_count_date')
  if (!typeId || !quantityId || !countQuantityId || !countDateId) return 0
  const occurredAtId = fieldId.get('stock_movement_occurred_at')
  const occurredField = occurredAtId ? { id: occurredAtId } : null

  const type = alias(schema.FieldValue, 'm193_type')
  const quantity = alias(schema.FieldValue, 'm193_qty')
  const occurred = alias(schema.FieldValue, 'm193_occurred')
  const fact = alias(schema.FieldValue, 'm193_fact')
  const rows = await db
    .select({
      id: schema.EntityInstance.id,
      entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      createdAt: schema.EntityInstance.createdAt,
      quantity: quantity.valueNumber,
      occurredAt: occurred.valueDate,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      type,
      and(systemValueJoin(type, typeId), eq(type.optionId, StockMovementType.INITIAL))
    )
    .innerJoin(quantity, systemValueJoin(quantity, quantityId))
    .leftJoin(occurred, systemValueJoin(occurred, optionalFieldId(occurredField)))
    .leftJoin(fact, systemValueJoin(fact, countQuantityId))
    .where(and(eq(schema.EntityInstance.organizationId, organizationId), isNull(fact.id)))
  if (rows.length === 0) return 0

  for (let start = 0; start < rows.length; start += STAMP_CHUNK) {
    const values = rows.slice(start, start + STAMP_CHUNK).flatMap((row) => {
      const stamp = countFactOf(row)
      const base = {
        organizationId,
        entityId: row.id,
        entityDefinitionId: row.entityDefinitionId,
        sortKey: nextKeyAfter(null),
      }
      return [
        buildFieldValueRow({
          ...base,
          fieldId: countQuantityId,
          fieldType: 'NUMBER',
          value: { type: 'number', value: stamp.countQuantity },
        }),
        buildFieldValueRow({
          ...base,
          fieldId: countDateId,
          fieldType: 'DATE',
          value: { type: 'date', value: stamp.countDate },
        }),
      ]
    })
    await db.insert(schema.FieldValue).values(values).onConflictDoNothing()
  }
  return rows.length
}

// ── The migration ───────────────────────────────────────────────────────────────

/** Migration 193: what brief 111 lands on existing orgs, one step per unit. */
export const migration193InventoryLedgerUnderMrp = {
  id: '193-inventory-ledger-under-mrp',
  description:
    "Brief 111 on existing orgs: the 'pending' cost basis option, 'relieve' work items re-staged to 'price', the 'backflush' build source, and the count fact stamped on every initial row",

  async up(db: Database, organizationId: string): Promise<InventoryLedgerMigrationResult> {
    const steps: InventoryLedgerMigrationSteps = {
      costBasisPendingAdded: await addPendingCostBasisOption(db, organizationId),
      ...(await restageRelieveWorkItems(db, organizationId)),
      buildSourceBackflushAdded: await addBackflushBuildSourceOption(db, organizationId),
      countFactFieldsCreated: await addCountFactFields(db, organizationId),
      initialsStamped: 0,
    }
    steps.initialsStamped = await stampInitialCountFacts(db, organizationId)
    const changed =
      steps.costBasisPendingAdded ||
      steps.workItemsRestaged > 0 ||
      steps.workItemsSuperseded > 0 ||
      steps.buildSourceBackflushAdded ||
      steps.countFactFieldsCreated > 0 ||
      steps.initialsStamped > 0
    if (changed) logger.info('Migration 193 applied', { organizationId, ...steps })
    return {
      entityDefsCreated: 0,
      fieldsCreated: steps.countFactFieldsCreated,
      relationshipsLinked: 0,
      alreadyUpToDate: !changed,
      steps,
    }
  },
} satisfies PerOrgMigration
