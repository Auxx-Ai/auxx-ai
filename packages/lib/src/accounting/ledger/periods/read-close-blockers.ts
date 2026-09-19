// packages/lib/src/accounting/ledger/periods/read-close-blockers.ts
//
// What a month still owes before it can be closed.
//
// Under the perpetual regime the close POSTS nothing (MIGRATION step 5): every
// inventory document wrote its own `inventory_movement` entry inside its own
// transaction, so a close is a CHECK: is every movement in an entry, do the
// movements and the accounts tie, and does the PARTS LIST agree with the
// accounts (73 §6.2 rule 4 - the one source that is not the ledger restated).
// The channel credit memo count is the old completeness gate, unchanged.
//
// 🛑 Reads only, and never throws. A month that cannot be checked is reported
// as a month with no findings, not as a month that cannot be closed: a broken
// read here must not be able to hold an organization's books hostage.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gt, gte, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getOrgCache } from '../../../cache'
import { readOrganizationSettings } from '../../../settings/read'
import { readTrialBalance } from '../../reports/trial-balance'
import { countUnissuedChannelCreditMemos } from '../../sales/credit-memos/reads'
import { cutoverDateFor } from '../builders/opening-balance'
import { INVENTORY_ROLES } from '../roles/regime'
import { readRoleAssignments } from '../roles/role-assignments'
import { OPENING_BASELINE_SETTING_KEYS } from '../setup/setup-readiness'
import {
  type CloseBlockerItem,
  describeIncompleteRevenue,
  describeInventoryBlockers,
} from './close-blockers'

const logger = createScopedLogger('postings:close-blockers')

/** The first day of the month and the first day of the next, `YYYY-MM-DD`. */
function monthBounds(periodKey: string): { first: string; next: string; last: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  const pad = (value: number) => String(value).padStart(2, '0')
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const next = `${nextYear}-${pad(nextMonth)}-01`
  const last = new Date(`${next}T00:00:00.000Z`)
  last.setUTCDate(last.getUTCDate() - 1)
  return { first: `${year}-${pad(month)}-01`, next, last: last.toISOString().slice(0, 10) }
}

/**
 * Movements dated inside the month that no POSTED `inventory_movement` entry
 * links as a member.
 *
 * The link, never a stamp field on the movement: `GlPostingSource` is the one
 * place a posting says what it booked (TARGET §1), and a movement whose entry
 * was reversed is unposted again for free, because the reversal deletes the
 * original's subject row and flips it to `reversed`.
 */
async function countUnpostedMovements(
  db: Database,
  organizationId: string,
  bounds: { first: string; next: string }
): Promise<number> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['stock_movement_occurred_at', 'stock_movement_extended_cost'] as const)
  const occurredAt = fields.stock_movement_occurred_at
  const extendedCost = fields.stock_movement_extended_cost
  if (!occurredAt || !extendedCost) return 0

  const posted = db
    .select({ sourceId: schema.GlPostingSource.sourceId })
    .from(schema.GlPostingSource)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId))
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.sourceKind, 'stock_movement'),
        eq(schema.GlPostingSource.linkRole, 'member'),
        eq(schema.GlPosting.status, 'posted')
      )
    )

  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, schema.FieldValue.organizationId)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, occurredAt.id),
        isNotNull(schema.FieldValue.valueDate),
        gte(sql`${schema.FieldValue.valueDate}::date`, bounds.first),
        lt(sql`${schema.FieldValue.valueDate}::date`, bounds.next),
        sql`${schema.FieldValue.entityId} NOT IN ${posted}`
      )
    )

  return Number(row?.count ?? 0)
}

/**
 * The opening baseline plus Σ frozen `stock_movement_extended_cost` for every
 * movement dated after the cutover and on or before the month's last day.
 *
 * Movements at or before the cutover are the old system's; the opening baseline
 * replaces that history, and it is what the ledger side holds for the same days.
 *
 * `adjust_subparts` rows are excluded, the same population every other cost read
 * excludes: an exploded child row is a second copy of a value its parent already
 * carries.
 */
async function readSubledgerValue(
  db: Database,
  organizationId: string,
  window: { cutoverDate: string | null; openingMinor: number; lastDay: string }
): Promise<number> {
  const { cutoverDate, openingMinor, lastDay } = window
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'stock_movement_occurred_at',
      'stock_movement_extended_cost',
      'stock_movement_adjust_subparts',
    ] as const)
  const occurredAt = fields.stock_movement_occurred_at
  const extendedCost = fields.stock_movement_extended_cost
  const adjustSubparts = fields.stock_movement_adjust_subparts
  if (!occurredAt || !extendedCost) return openingMinor

  const dated = db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, occurredAt.id),
        isNotNull(schema.FieldValue.valueDate),
        ...(cutoverDate ? [gt(sql`${schema.FieldValue.valueDate}::date`, cutoverDate)] : []),
        lte(sql`${schema.FieldValue.valueDate}::date`, lastDay)
      )
    )

  const exploded = adjustSubparts
    ? db
        .select({ entityId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, adjustSubparts.id),
            eq(schema.FieldValue.valueBoolean, true)
          )
        )
    : null

  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.FieldValue.valueNumber}), 0)` })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, extendedCost.id),
        sql`${schema.FieldValue.entityId} IN ${dated}`,
        ...(exploded ? [sql`${schema.FieldValue.entityId} NOT IN ${exploded}`] : [])
      )
    )

  return openingMinor + Math.round(Number(row?.total ?? 0))
}

/** The three inventory accounts' balance through one day, in minor units. */
async function readInventoryLedgerValue(
  db: Database,
  organizationId: string,
  lastDay: string
): Promise<number> {
  const assignments = await readRoleAssignments(db, organizationId)
  const inventoryAccountIds = new Set(
    assignments
      .filter((row) => (INVENTORY_ROLES as readonly string[]).includes(row.role))
      .map((row) => row.glAccountId)
  )
  if (inventoryAccountIds.size === 0) return 0

  const balance = await readTrialBalance(db, { organizationId, to: lastDay })
  if (balance.isErr()) throw balance.error

  return balance.value.rows
    .filter((row) => inventoryAccountIds.has(row.glAccountId))
    .reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0)
}

/**
 * Σ `part_quantity_on_hand x part_standard_cost` over the non-archived parts
 * list — the close's SECOND source (73 §6.2 rule 4).
 *
 * 🛑 **Independent by construction.** `readSubledgerValue` and
 * `readInventoryLedgerValue` are the same money added twice, so a residue
 * hand-written into an inventory account ties against both. This figure never
 * touches a movement or a posting: it is what the shelf says it is worth, and
 * under 73 every movement is valued at standard, so it must equal the accounts.
 *
 * ⚠️ Quantity on hand has no history, so this is the shelf as it stands NOW
 * against the accounts through `lastDay`. Closing a month long past will
 * therefore report a difference that is really the months since; the check is
 * written for the ordinary close, a few days after the month ends.
 *
 * `null` when either field is unprovisioned — an org without them gets no item
 * rather than a blocker it cannot act on.
 */
async function readPartsListStandardValue(
  db: Database,
  organizationId: string
): Promise<number | null> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_quantity_on_hand', 'part_standard_cost'] as const)
  const quantity = fields.part_quantity_on_hand
  const standard = fields.part_standard_cost
  if (!quantity || !standard) return null

  const standardValue = alias(schema.FieldValue, 'part_standard')
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.FieldValue.valueNumber} * ${standardValue.valueNumber}), 0)`,
    })
    .from(schema.FieldValue)
    .innerJoin(
      standardValue,
      and(
        eq(standardValue.organizationId, schema.FieldValue.organizationId),
        eq(standardValue.entityId, schema.FieldValue.entityId),
        eq(standardValue.fieldId, standard.id)
      )
    )
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, schema.FieldValue.organizationId)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, quantity.id),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  return Math.round(Number(row?.total ?? 0))
}

/** Where the old system's books end and what inventory was worth there. */
async function readCutover(
  organizationId: string
): Promise<{ cutoverDate: string | null; openingMinor: number }> {
  const K = OPENING_BASELINE_SETTING_KEYS
  const settings = await readOrganizationSettings(organizationId, [
    K.cutoffPeriod,
    K.inventory_raw_materials,
    K.inventory_wip,
    K.inventory_finished_goods,
  ] as const)
  const cutoff = settings[K.cutoffPeriod]?.trim() || null
  const openingMinor = [K.inventory_raw_materials, K.inventory_wip, K.inventory_finished_goods]
    .map((key) => settings[key])
    .reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
  return { cutoverDate: cutoff ? cutoverDateFor(cutoff) : null, openingMinor }
}

export interface CloseBlockersResult {
  periodKey: string
  items: CloseBlockerItem[]
}

/**
 * Every blocker standing between one month and its close.
 *
 * @param db Reads only.
 * @param options The organization and the MONTH key, `'2026-08'`.
 * @returns The outstanding work. Empty means the month is ready to lock.
 */
export async function readCloseBlockers(
  db: Database,
  options: { organizationId: string; periodKey: string }
): Promise<CloseBlockersResult> {
  const { organizationId, periodKey } = options
  const bounds = monthBounds(periodKey)
  if (!bounds) return { periodKey, items: [] }

  const items: CloseBlockerItem[] = []

  try {
    const memos = await countUnissuedChannelCreditMemos(db, { organizationId, month: periodKey })
    items.push(
      ...describeIncompleteRevenue({
        periodKey,
        shipments: 0,
        draftChannelMemos: memos,
        unpostedCreditMemos: 0,
      })
    )
  } catch (error) {
    logger.error('Could not check the month for unposted revenue', {
      organizationId,
      periodKey,
      error,
    })
  }

  try {
    const cutover = await readCutover(organizationId)
    const [unpostedMovements, subledgerMinor, ledgerMinor, standardValueMinor] = await Promise.all([
      countUnpostedMovements(db, organizationId, bounds),
      readSubledgerValue(db, organizationId, { ...cutover, lastDay: bounds.last }),
      readInventoryLedgerValue(db, organizationId, bounds.last),
      readPartsListStandardValue(db, organizationId),
    ])
    items.push(
      ...describeInventoryBlockers({
        periodKey,
        unpostedMovements,
        subledgerMinor,
        ledgerMinor,
        standardValueMinor,
      })
    )
  } catch (error) {
    logger.error('Could not check the month against the movement ledger', {
      organizationId,
      periodKey,
      error,
    })
  }

  return { periodKey, items }
}
