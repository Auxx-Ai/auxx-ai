// packages/lib/src/inventory/receiving/set-count.ts

/**
 * `setCount` — the one count door (111 D21): "I have N as of D".
 *
 * No `initial` on the part: one `initial` is written at the ledger start (the day before the
 * part's earliest movement, or D itself when there is none), quantity `N − net(D)`, carrying
 * the count fact so `reanchorInitials` can re-derive it when older history arrives (Q26).
 * An `initial` exists: one `adjust` dated D for `N − net(D)`; movements after D stand (Q15).
 * A count that changes nothing writes nothing.
 *
 * Cost: the part's standard. A typed `unitCost` sets a first one (rolling the parents it
 * completes) or restates one through the typed door, revaluing a moved part (09 D-SC2a); a part
 * with a BOM refuses it (D-SC3). A part still holding none writes a `pending` row at `price`.
 * The entry posts through `postInventoryDocumentInTx`, which decides by date (Q19): nothing
 * at or before the cutover, Count Variance after it.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  addDaysToDayKey,
  dayKeyInZone,
  isDayKeyShape,
  previousDayKey,
  startOfDayInstant,
  todayInZone,
} from '@auxx/utils/calendar-day'
import { isAtPrecision, RATE_DECIMALS, roundMinorUnits } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { postInventoryDocumentInTx } from '../../accounting/ledger/post/post-inventory-document'
import { exportInventoryMovement } from '../../accounting/ledger/post/post-inventory-movement'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { upsertWorkItem } from '../../accounting/work-items/write'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { StockMovementCostBasis, StockMovementType } from '../../resources/registry/enum-values'
import { systemDefId } from '../../resources/system-records'
import { isServicePartKind } from '../costing/client'
import { readEarliestMovementAt, readPartNetThrough } from '../costing/dated-reads'
import { ensureStandardCost } from '../costing/ensure-standard-cost'
import { batchRecalculateQoH } from '../costing/qoh'
import { rollUnvaluedAncestors } from '../costing/roll-unvalued-ancestors'
import {
  bomRefusal,
  readPartIdsWithBom,
  type StandardCostWrite,
  setStandardCost,
} from '../costing/set-standard-cost'
import { writeStockMovements } from '../movements'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { assertCostFieldsMaterialized } from '../movements/cost-fields'
import { readPartInitials } from '../movements/initial-queries'
import type { MovementRecord } from '../movements/types'
import { guard } from './guard'
import { readPartKind, readPartStandardCost } from './receipt-queries'
import type { SetCountInput, SetCountResult } from './types'

export type { SetCountInput, SetCountOutcome, SetCountResult } from './types'

const logger = createScopedLogger('inventory:set-count')

/** The last instant of `dayKey` in `zone`: everything dated on the count day counts. */
export function endOfDayInstant(dayKey: string, zone: string): Date {
  return new Date(startOfDayInstant(addDaysToDayKey(dayKey, 1), zone).getTime() - 1)
}

/** Where a first count's `initial` lands: the day before the earliest movement, never after D. */
export function anchorDayFor(countDate: string, earliest: Date | null, zone: string): string {
  if (!earliest) return countDate
  const beforeEarliest = previousDayKey(dayKeyInZone(earliest, zone))
  return beforeEarliest < countDate ? beforeEarliest : countDate
}

export async function setCount(
  db: Database,
  organizationId: string,
  input: SetCountInput
): Promise<Result<SetCountResult, Error>> {
  return guard(
    async () => {
      assertCountQuantity(input.quantity)
      if (input.day != null && !isDayKeyShape(input.day)) {
        throw new BadRequestError('A count day must be YYYY-MM-DD', { day: input.day })
      }
      if (input.unitCost != null) assertCountUnitCost(input.unitCost)

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await systemDefId(db, organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }
      await assertCostFieldsMaterialized(
        organizationId,
        'Set count is not available until the stock movement cost fields are provisioned'
      )

      const kind = await readPartKind(db, organizationId, input.partId)
      if (kind.isErr()) throw kind.error
      if (isServicePartKind(kind.value)) {
        throw new BadRequestError('A service holds no stock, so it cannot be counted', {
          partId: input.partId,
        })
      }
      const glAccount = resolveInventoryRoleForPartKind(kind.value)

      const zone = await readBookTimeZoneOrUtc(organizationId)
      const countDate = input.day ?? todayInZone(zone)
      const [nets, earliests, initials] = await Promise.all([
        readPartNetThrough(organizationId, [input.partId], endOfDayInstant(countDate, zone)),
        readEarliestMovementAt(organizationId, [input.partId]),
        readPartInitials(db, organizationId, [input.partId]),
      ])
      const net = nets.get(input.partId) ?? 0
      const earliest = earliests.get(input.partId) ?? null
      const initial = initials.get(input.partId) ?? null
      const delta = input.quantity - net
      if (!initial && earliest == null && input.quantity === 0) {
        throw new BadRequestError(
          'A count of zero on a part with no history anchors nothing. Count it once it has stock or movements.',
          { partId: input.partId }
        )
      }

      const userId = input.actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))
      // Before the delta check: a typed cost on an unchanged count is still applied.
      const standardCostChange =
        input.unitCost != null
          ? await applyCountUnitCost(db, organizationId, userId, input.partId, input.unitCost)
          : null
      const base = {
        partId: input.partId,
        countQuantity: input.quantity,
        countDate,
        net,
        delta,
        standardCostChange,
      }
      if (delta === 0) {
        return { ...base, outcome: 'unchanged', movement: null, pending: false }
      }

      const standard = await resolveCountCost(db, organizationId, input)
      const row = initial
        ? { type: StockMovementType.ADJUST, occurredAt: startOfDayInstant(countDate, zone) }
        : {
            type: StockMovementType.INITIAL,
            occurredAt: startOfDayInstant(anchorDayFor(countDate, earliest, zone), zone),
            count: { quantity: input.quantity, date: countDate },
          }

      const { written, post } = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        const result = await writeStockMovements(
          { db: txDb, organizationId, userId, movementDefId, partDefId, lane: { kind: 'plain' } },
          [
            {
              partInstanceId: input.partId,
              type: row.type,
              quantity: delta,
              unitCost: standard.unitCost,
              costBasis:
                standard.unitCost == null
                  ? StockMovementCostBasis.PENDING
                  : StockMovementCostBasis.STANDARD,
              glAccount,
              occurredAt: row.occurredAt,
              reason: input.notes,
              ...('count' in row ? { count: row.count } : {}),
            },
          ]
        )
        if (result.isErr()) throw result.error
        const record = result.value.records[0]!
        return {
          written: record,
          // A pending row posts nothing; the pricer posts it once the standard lands.
          post:
            record.extendedCost != null
              ? await postInventoryDocumentInTx(
                  tx,
                  organizationId,
                  [
                    {
                      movementId: record.movementId,
                      partInstanceId: input.partId,
                      type: row.type,
                      quantity: delta,
                      extendedCost: record.extendedCost,
                      glAccount,
                      occurredAt: row.occurredAt,
                    },
                  ],
                  { actorUserId: userId, memo: input.notes }
                )
              : null,
        }
      })

      await batchRecalculateQoH(organizationId, [input.partId])
      await exportInventoryMovement(db, post)
      const pending = written.unitCost == null
      if (pending) {
        await upsertWorkItem(db, organizationId, {
          sourceKind: 'stock_movement',
          sourceId: written.movementId,
          stage: 'price',
          reasonCode: 'STANDARD_COST_MISSING',
          externalRef: input.partId,
          detail: {
            partIds: [input.partId],
            pendingMovementIds: [written.movementId],
            ...(standard.displayName ? { partName: standard.displayName } : {}),
          },
        })
      }

      const movement: MovementRecord = {
        movementId: written.movementId,
        recordId: written.recordId,
        partInstanceId: input.partId,
        quantity: delta,
        unitCost: written.unitCost,
        extendedCost: written.extendedCost,
        vendorUnitPrice: null,
        vendorPartId: null,
        glAccount,
        occurredAt: row.occurredAt,
        purchaseOrderLineId: null,
      }
      return { ...base, outcome: initial ? 'adjust' : 'initial', movement, pending }
    },
    'Failed to set count',
    { organizationId, partId: input.partId, quantity: input.quantity }
  )
}

function assertCountQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) throw new BadRequestError('A count must be a finite number')
  if (quantity < 0) {
    throw new BadRequestError('A count cannot be negative. Enter how many units are on the shelf.')
  }
}

/** Finite, zero or more, and no finer than a RATE — never rounded into a legal value. */
function assertCountUnitCost(unitCost: number): void {
  if (!Number.isFinite(unitCost) || !isAtPrecision(unitCost, RATE_DECIMALS)) {
    throw new BadRequestError('A unit cost must have at most five decimal places')
  }
  if (unitCost < 0) throw new BadRequestError('A unit cost cannot be negative')
}

/**
 * Apply a typed count cost: a first standard (then its parents roll, D-SC7), or a restate through
 * the typed door when it differs. Never silently dropped; a part with a BOM refuses it (D-SC3).
 */
async function applyCountUnitCost(
  db: Database,
  organizationId: string,
  userId: string,
  partId: string,
  typed: number
): Promise<StandardCostWrite | null> {
  const unitCost = roundMinorUnits(typed)
  const current = await readPartStandardCost(db, organizationId, partId)
  if (current.isErr()) throw current.error
  if (current.value.standardCost === unitCost) return null
  if ((await readPartIdsWithBom(db, organizationId, [partId])).has(partId)) throw bomRefusal()

  if (current.value.standardCost != null) {
    const restated = await setStandardCost(db, organizationId, { partId, unitCost }, { userId })
    if (restated.isErr()) throw restated.error
    return restated.value
  }

  const ensured = await ensureStandardCost(db, organizationId, [partId], {
    kind: 'opening-stock',
    unitCost,
  })
  if (ensured.isErr()) throw ensured.error
  if (ensured.value.writtenPartIds.length === 0) return null
  const rolled = await rollUnvaluedAncestors(db, organizationId, userId, [partId])
  if (rolled.isErr()) {
    logger.warn('Could not roll the parents of a counted first standard', {
      organizationId,
      partId,
      error: rolled.error.message,
    })
  }
  return { action: 'set', standardCost: unitCost, revaluationPostedMinor: 0 }
}

/**
 * The cost the row is written at: the part's standard. `null` means pending (111 Q18); a
 * negative or non-numeric standard refuses, since nothing downstream can value against one.
 */
async function resolveCountCost(
  db: Database,
  organizationId: string,
  input: SetCountInput
): Promise<{ unitCost: number | null; displayName: string | null }> {
  const standard = await readPartStandardCost(db, organizationId, input.partId)
  if (standard.isErr()) throw standard.error
  const { standardCost, displayName } = standard.value
  if (standardCost != null && (!Number.isFinite(standardCost) || standardCost < 0)) {
    const label = displayName ? `"${displayName}"` : `part ${input.partId}`
    throw new UnprocessableEntityError(
      `${label} holds a standard cost nothing can value stock at, so its count was not recorded. Roll its standard cost first.`,
      { partId: input.partId }
    )
  }
  return { unitCost: standardCost, displayName }
}
