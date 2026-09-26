// packages/lib/src/inventory/costing/revalue.ts

/**
 * `writeRevaluation` — the cost-only movement, and the one door that posts it
 * (73 §6.2 rule 2).
 *
 * A revaluation writes one `stock_movement` per part at **quantity 0** with a
 * signed `extendedCost` of `on-hand qty x delta standard`, then posts one
 * `inventory_movement` entry of kind `revalue`:
 * `Dr|Cr <inventory role> / Cr|Dr inventory_revaluation`. Quantity on hand is
 * untouched, which is what makes it safe to run against a shelf nobody counted.
 *
 * Two callers, built once: `rollStandardCost`'s step 4, and the first receipt
 * of a provisional part (§6.4). §7's landed-cost voucher is the third.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, withAccountingCommitLock } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import type { InTxPostResult } from '../../accounting/ledger/post/post-entry'
import {
  exportInventoryMovement,
  postInventoryMovementInTx,
} from '../../accounting/ledger/post/post-inventory-movement'
import { requireCachedEntityDefId } from '../../cache'
import { NotFoundError } from '../../errors'
import { getRealtimeService, publishRecordsChanged } from '../../realtime'
import { quietSession, type WriteSession } from '../../resources/crud/write-origin'
import { StockMovementCostBasis, StockMovementType } from '../../resources/registry/enum-values'
import { systemDefId } from '../../resources/system-records'
import { type StockMovementInput, writeStockMovementsBatch } from '../movements'
import { assertCostFieldsMaterialized } from '../movements/cost-fields'
import { guard } from './guard'
import { batchRecalculateQoH } from './qoh'

const logger = createScopedLogger('costing:revalue')

/** The prose recorded on every silent revaluation write. Greppable, and the audit trail. */
export const REVALUE_WRITE_LANE_REASON =
  'inventory revaluation writes its own quantity-0 movements, recalculates QoH and announces ' +
  'them after commit'

/** The quiet session revaluation writes through; {@link announceQuietRevalueWrites} covers it. */
export function revalueWriteSession(): WriteSession {
  return quietSession(REVALUE_WRITE_LANE_REASON, { coveredBy: 'announceQuietRevalueWrites' })
}

/** Announce rows a revaluation wrote silently: one `records:changed` frame per def, after commit. */
export function announceQuietRevalueWrites(
  organizationId: string,
  entityDefinitionId: string,
  recordIds: string[]
): void {
  if (recordIds.length === 0) return
  // `getRealtimeService()` throws synchronously when transport config is absent; never fail here.
  try {
    publishRecordsChanged(getRealtimeService(), organizationId, {
      entityDefinitionId,
      entries: recordIds.map((recordId) => ({ recordId })),
    }).catch(() => {})
  } catch {
    // Best effort. The next list fetch or channel rebind catches the rows up.
  }
}

/** One part's restatement. Both money figures are signed, in whole minor units. */
export interface RevaluationLine {
  partInstanceId: string
  /** `newStandard - previousStandard`, per unit. Negative when the standard fell. */
  unitDeltaMinor: number
  /** `unitDeltaMinor x quantityOnHand`, already rounded. The amount that posts. */
  extendedDeltaMinor: number
  /** The inventory ROLE (`resolveInventoryRoleForPartKind`), never a code. */
  glAccountRole: string
}

export interface WriteRevaluationInput {
  lines: readonly RevaluationLine[]
  /** The document's own accounting date. */
  occurredAt: Date
  /** Stamped on every movement and carried into the entry's memo. */
  reason: string
  reference?: string
}

export interface WriteRevaluationResult {
  movementIds: string[]
  /** Signed sum of every line's `extendedDeltaMinor`. */
  postedMinor: number
}

/**
 * Write the revaluation movements and post their one entry, together.
 *
 * Zero-delta lines are dropped before anything is written: a row that restates
 * nothing is noise in an append-only ledger, and `buildEntry` refuses a
 * zero-amount leg anyway. An input that reduces to nothing returns an empty
 * result rather than an error — it is the ordinary answer for a roll that moved
 * only parts with no stock on hand.
 *
 * The movements and the entry commit together under `withAccountingCommitLock`.
 * The movements take the quiet lane, so this function owes the QoH recalc and
 * the realtime announce after commit.
 */
export async function writeRevaluation(
  db: Database,
  organizationId: string,
  userId: string,
  input: WriteRevaluationInput
): Promise<Result<WriteRevaluationResult, Error>> {
  return guard(
    async () => {
      const lines = input.lines.filter((line) => line.extendedDeltaMinor !== 0)
      if (lines.length === 0) return { movementIds: [], postedMinor: 0 }

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await systemDefId(db, organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }
      await assertCostFieldsMaterialized(
        organizationId,
        'Revaluing inventory is not available until the stock movement cost fields are provisioned'
      )

      const { movementIds, affectedPartIds, post } = await db.transaction(async (tx) => {
        await withAccountingCommitLock(tx, organizationId)
        const txDb = tx as unknown as Database

        const inputs: StockMovementInput[] = lines.map((line) => ({
          partInstanceId: line.partInstanceId,
          type: StockMovementType.REVALUE,
          // The whole point: the count does not move, the value does.
          quantity: 0,
          unitCost: line.unitDeltaMinor,
          // The override is load-bearing — `computeExtendedCost(x, 0)` is 0.
          extendedCost: line.extendedDeltaMinor,
          costBasis: StockMovementCostBasis.STANDARD,
          glAccount: line.glAccountRole,
          occurredAt: input.occurredAt,
          reason: input.reason,
          reference: input.reference,
        }))

        const written = await writeStockMovementsBatch(
          {
            db: txDb,
            organizationId,
            userId,
            movementDefId,
            partDefId,
            lane: { kind: 'quiet', session: revalueWriteSession() },
          },
          inputs
        )
        if (written.isErr()) throw written.error
        const records = written.value.records

        const post: InTxPostResult | null = await postInventoryMovementInTx(tx, {
          organizationId,
          kind: 'revalue',
          // The first movement anchors the claim; every one is a member below,
          // the shape every multi-movement inventory document already has.
          subject: { sourceKind: 'stock_movement', sourceId: records[0]!.movementId },
          occurredAt: input.occurredAt,
          movements: records.map((record, i) => ({
            id: record.movementId,
            extendedCostMinor: lines[i]!.extendedDeltaMinor,
            glAccountRole: lines[i]!.glAccountRole,
          })),
          actorUserId: userId,
          memo: input.reason,
        })

        return {
          movementIds: records.map((record) => record.movementId),
          affectedPartIds: written.value.affectedPartIds,
          post,
        }
      })

      await exportInventoryMovement(db, post)
      // Quantity 0 leaves the sum alone, but a dated row can move a count anchor, which the
      // silenced `recalculatePartQoH` would re-derive; it also re-publishes QoH and stock status.
      await batchRecalculateQoH(organizationId, affectedPartIds)
      announceQuietRevalueWrites(organizationId, movementDefId, movementIds)
      // The covered lane sends no inverse frames: the parts' movement lists.
      announceQuietRevalueWrites(organizationId, partDefId, affectedPartIds)

      const postedMinor = lines.reduce((sum, line) => sum + line.extendedDeltaMinor, 0)
      logger.info('Posted an inventory revaluation', {
        organizationId,
        parts: lines.length,
        postedMinor,
        reason: input.reason,
      })

      return { movementIds, postedMinor }
    },
    'Failed to revalue inventory',
    { organizationId, lines: input.lines.length }
  )
}
