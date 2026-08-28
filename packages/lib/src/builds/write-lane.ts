// packages/lib/src/builds/write-lane.ts

/**
 * The ONE place that decides which write lane a build's ledger writes take.
 *
 * plans/products/build/01-build-plan.md section 3.5 trap 2.
 *
 * ## The choice
 *
 * `quietSession` — plan 04 section 3's C4/C5 mode: doors stay shut on purpose,
 * and the reason is typed, greppable and checkable rather than a comment nobody
 * can enforce. Its default origin is `automation`, so `sessionLane` resolves to
 * `'silent'` (no bus event, no realtime frame, no dedup enqueue) and the session
 * carries no `collector`, so neither dispatch door opens.
 *
 * ## Why not the three alternatives
 *
 * - **`skipEvents: true`** (what the plan originally said) is not merely
 *   `@deprecated`, it is **insufficient**. There are two doors onto
 *   `explodeBomMovement` and it closes only one. Door A is the per-write
 *   fan-out, gated by `derivePublishEvents`. Door B is the sync manifest:
 *   `createEntity` calls `syncCollectorOf(ctx.session)` and `recordCreated(...)`
 *   in a block gated on **neither** `publishEvents`, `txScope`, nor
 *   `skipEvents`. A `sync`-origin session with `skipEvents: true` is still
 *   captured, and the manifest consumer dispatches the native rules from it.
 * - **`seedSession`** reaches the same silent lane, but its reason string would
 *   be a lie: a build completion is production automation, not a seeder or a
 *   data migration. The door matrix justifies the seed column with "seeded data
 *   is shaped by the seeder, not by rules", which is not why a build is silent.
 * - **`absorbedSession`** requires a named aggregator that actually announces
 *   the movements on their behalf, and there is none — claiming one that does
 *   not exist is the B-16 defect `silent-write-conformance.test.ts` exists to
 *   catch.
 *
 * ## 🛑 What this lane makes load-bearing
 *
 * Silencing the rule silences BOTH halves of `mfg-stock-movements-created`, and
 * the second half is `recalculatePartQoH`, which fires regardless of the
 * `adjustSubparts` flag. So the single post-commit `batchRecalculateQoH` is not
 * an optimisation — it is the **only** thing that recalculates quantity on hand
 * for a build's movements, and it must cover the produced part and every
 * consumed part.
 *
 * ⚠️ `adjustSubparts: false` stays on every row regardless of the lane.
 * `explodeBomMovement` guards on that flag as its third statement, before any
 * query, and the create-time values are threaded rather than refetched, so a
 * `false` reaches that guard on every lane. It is the belt that keeps this safe
 * if the lane is ever changed.
 */

import { quietSession, type WriteSession } from '../resources/crud/write-origin'

/** The prose recorded on every silent build write. Greppable, and the audit trail. */
export const BUILD_WRITE_LANE_REASON =
  'build completion posts its own consume/produce ledger and recalculates QoH after commit'

/**
 * The session every movement-writing build path constructs its
 * `UnifiedCrudHandler` with.
 *
 * 🛑 Do NOT pass `skipEvents: true` alongside it. The deprecated alias still
 * wins over the session-derived lane, which would move the decision back to the
 * call site — the state this file exists to end — while closing only one of the
 * two doors.
 */
export function buildWriteSession(): WriteSession {
  return quietSession(BUILD_WRITE_LANE_REASON)
}
