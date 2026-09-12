// packages/lib/src/relief/write-lane.ts

/**
 * The ONE place that decides which write lane `relieveFulfillmentLines`'s
 * `sale` movements take.
 *
 * plans/money/tasks/50-batch-inventory-relief.md §1.7.
 *
 * ## The choice
 *
 * `quietSession` - the same lane `builds/write-lane.ts` uses, for the same
 * reason. Read that file's header for the full argument against
 * `skipEvents: true` (insufficient - it closes only one of the two dispatch
 * doors onto the sync manifest), `seedSession` (the wrong reason string - a
 * relief write is production automation, not seeded data) and
 * `absorbedSession` (there is no named aggregator announcing on relief's
 * behalf).
 *
 * ## 🛑 What this lane makes load-bearing, and why it is THREE things here
 *
 * `mfg-stock-movements-created` fires three native handlers on every
 * `stock_movement` create (`field-hooks/system-entity-rules.ts`):
 * `explodeBomMovement`, `recalculatePartQoH`, and
 * `recalculateFulfillmentLineRelieved`. Silencing the rule silences all
 * three:
 *
 * - `explodeBomMovement` is inert here regardless - relief never sets
 *   `adjustSubparts: true` (§1.5's "always false" rule), and that flag is the
 *   very first thing the trigger guards on.
 * - `recalculatePartQoH` is the same obligation `builds/write-lane.ts`
 *   documents: the single post-commit `batchRecalculateQoH` is not an
 *   optimisation, it is the ONLY thing that updates quantity on hand for
 *   these movements.
 * - `recalculateFulfillmentLineRelieved` has no build-side equivalent. Its
 *   own header (`field-hooks/post/fulfillment-line-rollups.ts`) names this
 *   exact caller and says a writer on the quiet lane "must ... call
 *   `recalculateFulfillmentLineQuantityRelieved` / the batch form explicitly
 *   after COMMIT" - without it `fulfillment_line_quantity_relieved` never
 *   moves, and the NEXT sync recomputes the same delta and relieves the same
 *   units again, forever (§1.5's own warning about `reverseMovement`, in a
 *   different disguise).
 *
 * So `relieveFulfillmentLines` carries TWO post-commit recalculation
 * obligations, not builds' one, and both are discharged in `relieve.ts`
 * immediately after the write transaction commits.
 */

import { getRealtimeService, publishRecordsChanged } from '../realtime'
import { quietSession, type WriteSession } from '../resources/crud/write-origin'

/** The prose recorded on every silent relief write. Greppable, and the audit trail. */
export const RELIEF_WRITE_LANE_REASON =
  'inventory relief writes its own sale movements and recalculates QoH plus the ' +
  'fulfillment line relieved roll-up after commit'

/** The session `relieveFulfillmentLines` constructs its write through. */
export function reliefWriteSession(): WriteSession {
  return quietSession(RELIEF_WRITE_LANE_REASON)
}

/**
 * Announce the `stock_movement` rows relief wrote silently - the ledger
 * card's own frame.
 *
 * `batchRecalculateQoH` and `recalculateFulfillmentLineQuantityRelievedBatch`
 * already publish the QoH/stock-status and roll-up VALUES they wrote; this
 * covers the movement ROWS themselves, exactly as `builds/write-lane.ts`'s
 * `publishQuietBuildWrites` does for a build's ledger - without it the part's
 * movement history card renders stale until a manual refresh.
 *
 * Tier-2 (`records:changed`), fire-and-forget, after the commit. No
 * `excludeSocketId`: unlike an interactive build completion, relief has no
 * "the tab that did this" to exclude - both callers are server-side
 * (`fulfillOrder`'s post-transaction step, and the sync finalize pass).
 */
export function announceQuietReliefWrites(
  organizationId: string,
  entityDefinitionId: string,
  recordIds: string[]
): void {
  if (recordIds.length === 0) return
  // 🛑 try/catch AND `.catch`, both - `getRealtimeService()` resolves transport
  // config and throws SYNCHRONOUSLY when it is absent, which a promise handler
  // never sees, and this runs after the commit, so a throw here must never
  // read back as a failed relief.
  try {
    publishRecordsChanged(getRealtimeService(), organizationId, {
      entityDefinitionId,
      entries: recordIds.map((recordId) => ({ recordId })),
    }).catch(() => {})
  } catch {
    // Best effort. The next list fetch or channel rebind catches the rows up.
  }
}
