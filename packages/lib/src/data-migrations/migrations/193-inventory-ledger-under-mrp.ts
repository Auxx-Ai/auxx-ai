// packages/lib/src/data-migrations/migrations/193-inventory-ledger-under-mrp.ts
// The one per-org migration for brief 111 (§13). Each unit adds a named step below; every
// step is idempotent on its own and reports separately, so a retry redoes only what failed.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
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
  const field = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.modelType, 'stock_movement'),
      eq(schema.CustomField.systemAttribute, COST_BASIS_ATTRIBUTE)
    ),
    columns: { id: true, options: true },
  })
  if (!field) return false
  const stored = (field.options as { options?: StoredOption[] } | null)?.options
  if (!Array.isArray(stored)) return false
  const next = withPendingOption(stored)
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

// ── The migration ───────────────────────────────────────────────────────────────

/** Migration 193: what brief 111 lands on existing orgs, one step per unit. */
export const migration193InventoryLedgerUnderMrp = {
  id: '193-inventory-ledger-under-mrp',
  description:
    "Brief 111 on existing orgs: the 'pending' cost basis option, and 'relieve' work items re-staged to 'price'",

  async up(db: Database, organizationId: string): Promise<InventoryLedgerMigrationResult> {
    const steps: InventoryLedgerMigrationSteps = {
      costBasisPendingAdded: await addPendingCostBasisOption(db, organizationId),
      ...(await restageRelieveWorkItems(db, organizationId)),
    }
    const changed =
      steps.costBasisPendingAdded || steps.workItemsRestaged > 0 || steps.workItemsSuperseded > 0
    if (changed) logger.info('Migration 193 applied', { organizationId, ...steps })
    return {
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: !changed,
      steps,
    }
  },
} satisfies PerOrgMigration
