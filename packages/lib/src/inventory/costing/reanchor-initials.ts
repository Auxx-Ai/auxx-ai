// packages/lib/src/inventory/costing/reanchor-initials.ts

/**
 * The `initial` is a derived anchor, not an event (111 Q26). It keeps the count fact
 * (N as of D) and is the ONE row on the append-only ledger allowed to move: when a movement
 * older than it arrives, or the replay no longer reads N on D, it is re-dated to the day before
 * the earliest other movement and re-quantified to `N − net(D)`. Runs in front of the QoH SUM,
 * so every writer already calls it after commit; idempotent, so its own rewrite is a no-op.
 *
 * Writes on the quiet automation lane, like `fillPendingCost`: no doors fire, and the caller
 * (`batchRecalculateQoH`) is the one that re-SUMs.
 */

import { type Database, database, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { dayKeyInZone, previousDayKey, startOfDayInstant } from '@auxx/utils/calendar-day'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { quietSession } from '../../resources/crud/write-origin'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { updateMovementFactAnchor } from '../movements/fact/writes'
import { type PartInitial, readPartInitials } from '../movements/initial-queries'
import { readEarliestMovementAt, readPartNetThrough } from './dated-reads'

const logger = createScopedLogger('costing:reanchor-initials')

/** The prose recorded on every silent re-anchor. Greppable, and the audit trail. */
export const REANCHOR_INITIAL_REASON =
  'an older movement arrived, so the count anchor is re-dated and re-quantified to keep the replay reading the counted quantity on the count day'

export interface ReanchoredInitial {
  movementId: string
  partInstanceId: string
  occurredAt: Date
  quantity: number
}

/** The MRP mirror follows the anchor: the one update it takes (111 §14, Q26). */
export async function onInitialReanchored(
  tx: Database | Transaction,
  movementId: string,
  anchor: { occurredAt: Date; quantity: number }
): Promise<void> {
  await updateMovementFactAnchor(tx, movementId, anchor)
}

/** The seam as the lane calls it, so a test can observe the call. */
export const anchorSeam = { onInitialReanchored }

/** The last instant of the count day, for the "through D" replay. */
function endOfDay(dayKey: string, zone: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number]
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return new Date(startOfDayInstant(next, zone).getTime() - 1)
}

/** What the anchor should read now, or `null` when it already does. Pure. */
export function planReanchor(
  initial: PartInitial,
  input: { earliest: Date | null; netThroughCountDate: number; zone: string }
): { occurredAt: Date; quantity: number } | null {
  if (initial.countQuantity == null || !initial.countDate) return null
  const { earliest, netThroughCountDate, zone } = input

  const initialDay = dayKeyInZone(initial.occurredAt, zone)
  let occurredAt = initial.occurredAt
  if (earliest && dayKeyInZone(earliest, zone) <= initialDay) {
    occurredAt = startOfDayInstant(previousDayKey(dayKeyInZone(earliest, zone)), zone)
  }

  // `net(D)` includes the initial itself whenever it is dated on or before D; take it back out.
  const countedThrough = endOfDay(initial.countDate, zone)
  const others =
    netThroughCountDate -
    (initial.occurredAt.getTime() <= countedThrough.getTime() ? initial.quantity : 0)
  const quantity = initial.countQuantity - others

  if (occurredAt.getTime() === initial.occurredAt.getTime() && quantity === initial.quantity) {
    return null
  }
  return { occurredAt, quantity }
}

/**
 * Re-derive the `initial` of every named part that carries a count fact. Returns the rows it
 * moved. Never throws: a failed re-anchor is logged and the SUM runs on what is stored.
 */
export async function reanchorInitials(
  organizationId: string,
  partIds: readonly string[]
): Promise<ReanchoredInitial[]> {
  const unique = [...new Set(partIds.filter(Boolean))]
  if (unique.length === 0) return []
  try {
    return await reanchor(organizationId, unique)
  } catch (error) {
    logger.error('Re-anchoring count initials failed; QoH sums what is stored', {
      organizationId,
      partIds: unique.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

async function reanchor(organizationId: string, partIds: string[]): Promise<ReanchoredInitial[]> {
  const initials = await readPartInitials(database, organizationId, partIds)
  const anchored = [...initials.values()].filter(
    (initial) => initial.countQuantity != null && initial.countDate
  )
  if (anchored.length === 0) return []

  const zone = await readBookTimeZoneOrUtc(organizationId)
  const earliests = await readEarliestMovementAt(
    organizationId,
    anchored.map((initial) => initial.partInstanceId),
    { excludeMovementIds: anchored.map((initial) => initial.movementId) }
  )
  // One replay per distinct count day: `readPartNetThrough` takes a single `through`.
  const byDay = new Map<string, string[]>()
  for (const initial of anchored) {
    const day = initial.countDate!
    byDay.set(day, [...(byDay.get(day) ?? []), initial.partInstanceId])
  }
  const nets = new Map<string, number>()
  for (const [day, parts] of byDay) {
    for (const [partId, net] of await readPartNetThrough(
      organizationId,
      parts,
      endOfDay(day, zone)
    )) {
      nets.set(partId, net)
    }
  }

  const moves = anchored.flatMap((initial) => {
    const plan = planReanchor(initial, {
      earliest: earliests.get(initial.partInstanceId) ?? null,
      netThroughCountDate: nets.get(initial.partInstanceId) ?? 0,
      zone,
    })
    return plan ? [{ initial, plan }] : []
  })
  if (moves.length === 0) return []

  const movementDefId = await requireCachedEntityDefId(organizationId, 'stock_movement')
  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const moved: ReanchoredInitial[] = []
  await database.transaction(async (tx) => {
    const crud = new UnifiedCrudHandler(
      organizationId,
      userId,
      tx as unknown as Database,
      undefined,
      {
        session: quietSession(REANCHOR_INITIAL_REASON),
      }
    )
    for (const { initial, plan } of moves) {
      await crud.update(toRecordId(movementDefId, initial.movementId) as RecordId, {
        stock_movement_occurred_at: plan.occurredAt.toISOString(),
        stock_movement_quantity: plan.quantity,
      })
      await anchorSeam.onInitialReanchored(tx, initial.movementId, plan)
      moved.push({
        movementId: initial.movementId,
        partInstanceId: initial.partInstanceId,
        ...plan,
      })
    }
  })
  logger.info('Re-anchored count initials', { organizationId, moved: moved.length })
  return moved
}
