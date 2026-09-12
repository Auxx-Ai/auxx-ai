// packages/lib/src/stock-movements/types.ts

/**
 * Input and output shapes for the shared `stock_movement` writer.
 *
 * plans/money/tasks/50-batch-inventory-relief.md §2.3 gives this contract
 * verbatim, with two additive deviations, both required to make the
 * extraction a zero-behaviour-change refactor of the five existing callers
 * (§2.6: "if a test needs editing, the refactor changed behaviour and is
 * wrong") rather than a literal transcription of the brief:
 *
 * 1. **`vendorUnitPrice` on the input.** The brief's contract has no slot for
 *    it, but `receive-stock.ts` stamps `stock_movement_vendor_unit_price` - a
 *    plain scalar, three-way-match provenance - distinct from the
 *    `vendorPartId` RELATIONSHIP in `links`. Every other caller leaves it
 *    undefined.
 * 2. **`costBasis` and `glAccount` are optional, not required.** The brief
 *    types both as required strings. `reverse-movement.ts` omits `costBasis`
 *    entirely when the original movement never carried one (a pre-migration
 *    row), and `reverse-build.ts` omits `glAccount` the same way. Making
 *    either required here would force every caller to invent a value where
 *    the current code deliberately writes no key at all.
 */

import type { Database } from '@auxx/database'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import type { WriteSession } from '../resources/crud/write-origin'

/**
 * The typed links a `stock_movement` may carry, per §2.4 item 4: one
 * definition, so a reversal (or any other writer) copies the whole set
 * instead of a hand-listed subset.
 *
 * Every value is a BARE `EntityInstance.id` - never a pre-built `RecordId` -
 * except where a caller already holds a `RecordId` (a `defId:id` string) for
 * one, which is accepted as-is so a caller that already resolved its own def
 * id (a build's own context, for instance) is not made to resolve it twice.
 */
export interface StockMovementLinks {
  vendorPartId?: string
  purchaseOrderLineId?: string
  buildId?: string
  reversesMovementId?: string
  parentMovementId?: string
  fulfillmentLineId?: string
}

/** One `stock_movement` row to write. §2.3, plus the two deviations above. */
export interface StockMovementInput {
  /** `EntityInstance.id` of the `part` this movement is against. */
  partInstanceId: string
  /** A `StockMovementType` value. */
  type: string
  /** SIGNED. The sign convention lives here and nowhere else. */
  quantity: number
  /** Minor units, at `RATE_DECIMALS`. */
  unitCost: number
  /** A `StockMovementCostBasis` value. Omit only to omit the key entirely (see above). */
  costBasis?: string
  /** An inventory ROLE (`resolveInventoryRoleForPartKind`), never a code. Omit only to omit the key (see above). */
  glAccount?: string
  occurredAt: Date
  /**
   * Override for `computeExtendedCost(unitCost, quantity)`, for a caller that
   * already has the signed amount and must not risk a rounding-tiebreak
   * disagreement by recomputing it - `complete-build.ts`'s negated
   * `build_consume` row is the case this exists for (§2.2).
   */
  extendedCost?: number
  /**
   * Opt-IN, and it must carry a `reason`. `false` (the default you get by
   * saying nothing) is what every one of the six existing callers writes,
   * always - §2.4 item 1.
   */
  adjustSubparts?: true
  reason?: string
  reference?: string
  links?: StockMovementLinks
  /** The as-built BOM snapshot. `null`/absent is the OFF-BOM marker - never write a 0. */
  qtyPerUnit?: number | null
  /**
   * Not part of the brief's contract - see the file header, deviation 1.
   * Three-way-match provenance, `receive-stock.ts` only.
   */
  vendorUnitPrice?: number
}

/** One `stock_movement` this call wrote, back to the caller. */
export interface WrittenStockMovement {
  movementId: string
  /** `<entityDefinitionId>:<instanceId>`. */
  recordId: string
  partInstanceId: string
  quantity: number
  unitCost: number
  extendedCost: number
  glAccount: string | null
  occurredAt: Date
}

/** What a `writeStockMovements` call did. */
export interface WriteStockMovementsResult {
  /** In the same order as the `inputs` array. */
  records: WrittenStockMovement[]
  /**
   * Distinct `partInstanceId`s across every input. The quiet lane's caller
   * MUST pass this to `batchRecalculateQoH` after its transaction commits -
   * §2.4 item 3 is what makes that a structural fact instead of a comment.
   */
  affectedPartIds: string[]
}

/**
 * Which write lane the movements land on (§2.2 - "must be a parameter and
 * not a branch"):
 *
 * - `'plain'`: the ordinary interactive lane. `mfg-stock-movements-created`
 *   fires per row and `recalculatePartQoH` updates quantity on hand. Used by
 *   `receive-stock.ts`, `adjust-stock.ts` and `reverse-movement.ts`.
 * - `'quiet'`: `txDb` + a `quietSession` + the post-commit recalc obligation
 *   (`affectedPartIds` above). Used by `complete-build.ts` and
 *   `reverse-build.ts`, both inside `db.transaction()`.
 */
export type StockMovementsLane =
  | { kind: 'plain' }
  | {
      kind: 'quiet'
      session: WriteSession
      /**
       * Builds-only (§2.2): the guard `stock_movement` has no attribute of its
       * own, so forwarding a build's `bypassFieldGuards` here is inert for
       * every field this module writes and exists only so the ONE
       * `UnifiedCrudHandler` a caller might otherwise need per write stays a
       * single construction site. See `complete-build.ts`'s note on
       * `bypassFieldGuards`, reproduced verbatim there.
       */
      bypassFieldGuards?: ReadonlySet<SystemAttribute>
    }

/**
 * `db | tx, organizationId, userId, lane` (50 §2.3), plus the two def ids
 * every one of the six existing callers already resolves for its own
 * pre-checks before it ever reaches a write. Passing them in here (rather
 * than re-resolving inside this module) avoids a second cache round trip and
 * keeps each caller's own "this organization has no X definition" refusal -
 * worded and timed exactly as it is today - outside this module entirely.
 */
export interface StockMovementsCtx {
  /** A pool connection for the `'plain'` lane, `tx as unknown as Database` for `'quiet'`. */
  db: Database
  organizationId: string
  userId: string
  /** `EntityInstance.id` of the org's `stock_movement` entity definition. */
  movementDefId: string
  /** `EntityInstance.id` of the org's `part` entity definition. */
  partDefId: string
  lane: StockMovementsLane
  /**
   * A `UnifiedCrudHandler` this call MUST write through, instead of
   * constructing its own.
   *
   * A caller that makes several `writeStockMovements` calls inside one
   * quiet-lane write (`complete-build.ts` splits consume from produce so the
   * produce row's GL account can be resolved after every consume row has
   * landed) must still route every movement through the SAME handler it
   * updates its own row with - `build-event.test.ts` pins "one handler
   * construction per quiet-lane completion" as the proof `bypassFieldGuards`
   * cannot silently disarm a guard on an attribute nobody meant to bypass.
   * Omit it and this function constructs its own, exactly as a
   * single-movement writer (`receive-stock.ts`, `adjust-stock.ts`,
   * `reverse-movement.ts`) already does.
   */
  handler?: UnifiedCrudHandler
}
