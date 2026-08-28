// packages/lib/src/purchasing/aging-sweep.ts

/**
 * The clock behind P24.
 *
 * A bill for goods that have not arrived is `awaiting_receipt` rather than an
 * exception, and it AGES: once the purchase order's `expectedAt` plus
 * `DEFAULT_MATCH_TOLERANCE.receiptGraceDays` has passed, the same match calls it
 * `receipt_overdue` and the bill becomes a real `exception`.
 *
 * 🛑 That aging was computed only when something else re-triggered the match — a
 * bill line edit, or a receipt landing (`rematchBillsForPurchaseOrderLines`).
 * Nothing was time-driven, so a bill whose goods NEVER arrive sat amber forever,
 * which is precisely the failure mode P24's simpler alternative was rejected for.
 * This module is the missing trigger.
 *
 * ## Why a sweep and not a read-time derivation
 *
 * `vendor_bill_status` is a STORED field. The exception queue filters and sorts
 * on it, record rules fire off it, the sync manifest exports it, and
 * `vendor_bill_match_notes` — the prose a human reads in the queue — is written
 * beside it by the same call. Deriving "actually overdue" at read time would fix
 * one badge and leave every one of those consumers reading the stale value, and
 * it would mean two places decided what a bill's status is. The subsystem has
 * been bitten by exactly that kind of divergence. So: a writer.
 *
 * ## Why it reuses `rematchBill` rather than writing the status itself
 *
 * The verdict is `matchBill`'s to give and `rematchBill`'s to store. This module
 * decides only WHICH bills to re-ask about, and it decides that with the same
 * pure predicate the match uses (`isReceiptOverdue`), so there is no second
 * definition of "late" anywhere. `rematchBill` skips the write entirely when all
 * three stored values already equal the verdict, so an over-selected bill costs
 * a read and nothing else.
 *
 * ## The write is LOUD, deliberately
 *
 * Nothing here reaches for `quietSession`. A bill crossing into `exception` is
 * the single event this whole mechanism exists to surface — it must publish to
 * realtime so an open queue updates, fire record rules, and reach the sync
 * manifest. A quiet lane would reproduce the invisibility being fixed. (It would
 * also silence the QoH recalc, which is irrelevant here only because this path
 * writes no movements.)
 */

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { readFieldRelations, readFieldScalars } from '../field-values/read-field-scalars'
import { SystemUserService } from '../users/system-user-service'
import { DEFAULT_MATCH_TOLERANCE, isReceiptOverdue } from './match'
import { rematchBill } from './match-hook'

const logger = createScopedLogger('purchasing:aging-sweep')

/**
 * The stored `vendor_bill_status` value the sweep hunts for.
 *
 * A SINGLE_SELECT stores its value in `FieldValue.optionId`, and for this seeded
 * field the option id IS the status key (`draft` / `awaiting_receipt` /
 * `matched` / `exception` / …), which is also why `rematchBill`'s no-op guard can
 * compare a scalar read straight against `MatchResult['outcome']`.
 */
const AWAITING_RECEIPT = 'awaiting_receipt'

/** Bounded IN-list, same 200 `read-field-scalars.ts` uses and for the same reason. */
const CHUNK = 200

/** The field ids one org's pass needs, resolved once from the org cache. */
const SWEEP_ATTRS = [
  'vendor_bill_line_vendor_bill',
  'vendor_bill_line_purchase_order_line',
  'purchase_order_line_purchase_order',
  'purchase_order_expected_at',
] as const satisfies readonly SystemAttribute[]

/** What one run did, for the job log and for tests. */
export interface VendorBillAgingSweepSummary {
  /** Organizations that held at least one `awaiting_receipt` bill. */
  organizations: number
  /** `awaiting_receipt` bills found across every organization. */
  candidates: number
  /** Bills whose grace period had expired and were handed to `rematchBill`. */
  rematched: number
  /** Organizations or bills that threw. One failure never aborts the rest. */
  failures: number
}

/**
 * Re-ask the three-way match about every `awaiting_receipt` bill whose purchase
 * order is now past `expectedAt + receiptGraceDays`.
 *
 * Runs across organizations. Each organization and each bill is isolated: a
 * missing field, a missing system user or a failing match takes that unit out of
 * the run and nothing else.
 *
 * @param asOf The instant to age against. Defaults to now; a parameter so the
 *   selection is testable without a fake clock and so a backfill can be run at a
 *   chosen instant. ⚠️ `rematchBill` reads its OWN `new Date()` for the verdict,
 *   which is always at or after this one — so a bill selected as late is still
 *   late when the match runs. Passing a FUTURE `asOf` therefore selects bills the
 *   match will then decline to call late; that is a deliberate one-way skew, not
 *   a way to time-travel the verdict.
 */
export async function sweepAgingVendorBills(
  asOf: Date = new Date()
): Promise<VendorBillAgingSweepSummary> {
  const summary: VendorBillAgingSweepSummary = {
    organizations: 0,
    candidates: 0,
    rematched: 0,
    failures: 0,
  }

  const byOrg = await findAwaitingReceiptBills()
  summary.organizations = byOrg.size
  for (const ids of byOrg.values()) summary.candidates += ids.length

  for (const [organizationId, vendorBillInstanceIds] of byOrg) {
    try {
      const overdue = await selectOverdueBills(organizationId, vendorBillInstanceIds, asOf)
      if (overdue.length === 0) continue

      const userId = await SystemUserService.getSystemUserForActions(organizationId)
      for (const vendorBillInstanceId of overdue) {
        try {
          await rematchBill({ organizationId, userId, vendorBillInstanceId })
          summary.rematched += 1
        } catch (error) {
          summary.failures += 1
          logger.error('Failed to re-match an aged vendor bill', {
            organizationId,
            vendorBillInstanceId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } catch (error) {
      summary.failures += 1
      logger.error('Vendor bill aging sweep failed for organization', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info('Vendor bill aging sweep finished', { ...summary, asOf: asOf.toISOString() })
  return summary
}

/**
 * Every live bill currently sitting in `awaiting_receipt`, grouped by organization.
 *
 * ONE query for the whole platform, and it is the reason this sweep is not a
 * nightly load spike: `awaiting_receipt` is a live working set — open prepaid
 * bills — not a table that grows with history. Anchoring on it means organizations
 * with no prepaid bills cost nothing at all, rather than a per-org pass each.
 * `FieldValue_lookup_option_idx (organizationId, fieldId, optionId)` serves the
 * inner side.
 *
 * The `EntityInstance` join is not decoration: archiving a bill leaves its
 * `FieldValue` rows in place, so without it an archived prepaid bill would be
 * re-matched every night for the rest of time.
 */
async function findAwaitingReceiptBills(): Promise<Map<string, string[]>> {
  const rows = await database
    .select({
      organizationId: schema.FieldValue.organizationId,
      vendorBillInstanceId: schema.FieldValue.entityId,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.CustomField.systemAttribute, 'vendor_bill_status'),
        eq(schema.FieldValue.optionId, AWAITING_RECEIPT),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const byOrg = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.organizationId || !row.vendorBillInstanceId) continue
    const ids = byOrg.get(row.organizationId)
    if (ids) {
      if (!ids.includes(row.vendorBillInstanceId)) ids.push(row.vendorBillInstanceId)
    } else {
      byOrg.set(row.organizationId, [row.vendorBillInstanceId])
    }
  }
  return byOrg
}

/**
 * Which of one organization's awaiting bills have actually crossed the boundary.
 *
 * Four set-based reads for the whole organization regardless of how many bills or
 * lines it has — bills → lines, lines → purchase order lines, purchase order lines
 * → orders, orders → `expectedAt`. This is the same ladder `rematchBill` walks,
 * walked the same batched way, for the same reason (#1953): a read per line here
 * would make the sweep's cost the thing that hurts rather than the matches it
 * triggers.
 *
 * ⚠️ It reads DATES only, never quantities. Whether a line is actually still
 * short is `matchBill`'s call, and asking it here would be a second implementation
 * of the verdict. The consequence is that this can over-select — a bill whose
 * earliest-dated line was received while a later, dateless line still awaits will
 * be re-matched each night and reach the same answer. `rematchBill` compares all
 * three stored values before writing, so that costs one read and writes nothing.
 * Under-selecting is the failure that would matter, and the date arm cannot
 * under-select: a bill is passed on as soon as ANY of its orders is late.
 */
async function selectOverdueBills(
  organizationId: string,
  vendorBillInstanceIds: string[],
  asOf: Date
): Promise<string[]> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([...SWEEP_ATTRS])

  const billRelId = cf.vendor_bill_line_vendor_bill?.id
  const poLineRelId = cf.vendor_bill_line_purchase_order_line?.id
  const orderRelId = cf.purchase_order_line_purchase_order?.id
  const expectedAtFieldId = cf.purchase_order_expected_at?.id
  // An organization missing any rung cannot age anything. Not an error — an org
  // that predates a field simply has no aged bills until the migration reaches it.
  if (!billRelId || !poLineRelId || !orderRelId || !expectedAtFieldId) {
    logger.warn('Missing purchasing fields — skipping organization', { organizationId })
    return []
  }

  // Bill -> its lines. The inverse direction, so it is a `relatedEntityId` lookup
  // rather than a `readFieldRelations`, exactly as `rematchBillsForPurchaseOrderLines`
  // does it.
  const lineToBill = new Map<string, string>()
  for (const chunk of chunks(vendorBillInstanceIds)) {
    const rows = await database
      .select({
        lineInstanceId: schema.FieldValue.entityId,
        vendorBillInstanceId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, billRelId),
          inArray(schema.FieldValue.relatedEntityId, chunk)
        )
      )
    for (const row of rows) {
      if (row.lineInstanceId && row.vendorBillInstanceId) {
        lineToBill.set(row.lineInstanceId, row.vendorBillInstanceId)
      }
    }
  }
  if (lineToBill.size === 0) return []

  const lineIds = [...lineToBill.keys()]
  const lineRels = await readFieldRelations(undefined, organizationId, lineIds, [poLineRelId])

  const poLineIds = lineIds
    .map((id) => lineRels.get(id)?.get(poLineRelId))
    .filter((id): id is string => !!id)
  if (poLineIds.length === 0) return []

  const poLineRels = await readFieldRelations(undefined, organizationId, poLineIds, [orderRelId])
  const orderIds = poLineIds
    .map((id) => poLineRels.get(id)?.get(orderRelId))
    .filter((id): id is string => !!id)
  if (orderIds.length === 0) return []

  const orderValues = await readFieldScalars(undefined, organizationId, orderIds, [
    expectedAtFieldId,
  ])

  const overdue = new Set<string>()
  for (const [lineInstanceId, vendorBillInstanceId] of lineToBill) {
    if (overdue.has(vendorBillInstanceId)) continue
    const poLineId = lineRels.get(lineInstanceId)?.get(poLineRelId)
    if (!poLineId) continue
    const orderId = poLineRels.get(poLineId)?.get(orderRelId)
    if (!orderId) continue
    const expectedAt = toDate(orderValues.get(orderId)?.get(expectedAtFieldId))
    if (isDateArmOverdue(expectedAt, asOf)) overdue.add(vendorBillInstanceId)
  }

  // Stable order so a run is reproducible and a log is diffable.
  return vendorBillInstanceIds.filter((id) => overdue.has(id))
}

/**
 * Has `expectedAt + receiptGraceDays` passed, asked of `isReceiptOverdue` itself?
 *
 * 🛑 The grace arithmetic, the strictly-past comparison and the "no date means
 * never late" rule are P24's, and they must have exactly ONE definition. So this
 * does not re-derive them — it probes the real predicate with a line whose
 * quantity arm is known short (`1` billed, `0` received) and whose prices are
 * irrelevant to it, which isolates the date arm. The quantity arm is not this
 * module's question: `rematchBill` answers it authoritatively a moment later.
 */
function isDateArmOverdue(expectedAt: Date | null, asOf: Date): boolean {
  return isReceiptOverdue(
    {
      quantityBilled: 1,
      quantityReceived: 0,
      unitPriceBilled: 0,
      unitPriceExpected: 0,
      expectedAt,
    },
    DEFAULT_MATCH_TOLERANCE,
    asOf
  )
}

/**
 * `FieldValue.valueDate` is `timestamp(..., { mode: 'string' })`, so a scalar read
 * hands back an ISO STRING and not a `Date` — the twin of `match-hook.ts`'s `date`
 * helper, and wrong in the same way if it forgets that. An unparseable value
 * degrades to `null`, which reads as "no expected date" and leaves the bill alone.
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function chunks(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)]
  const out: string[][] = []
  for (let i = 0; i < unique.length; i += CHUNK) out.push(unique.slice(i, i + CHUNK))
  return out
}
