// packages/lib/src/field-hooks/pre/build-status-guard.ts

import {
  BUILD_ACTION_STATUS_MESSAGE,
  BUILD_ACTION_STATUSES,
} from '../../resources/hooks/lifecycle-status-guard'
import type { FieldPreHookHandler } from '../types'
import { createFieldLifecycleStatusGuard } from './lifecycle-status-guard'

/**
 * The manual-`in_progress`/`completed`/`canceled` wall for `build_status`.
 *
 * 🛑 **The build subsystem already enforced its transitions, on a door nobody interactive
 * uses.** `startBuild` / `completeBuild` / `cancelBuild` / `reverseBuild` all call
 * `assertBuildStatus` (`builds/build-queries.ts`) against the `canStartBuild` /
 * `canCompleteBuild` / `canCancelBuild` / `canReverseBuild` predicates, so the transition
 * matrix is correct *inside those functions*. `fieldValue.set` never reaches them. Every
 * drawer edit, grid inline edit, kanban drag and Kopilot record tool goes
 * `useSaveFieldValue -> api.fieldValue.set -> FieldValueService -> fireFieldPreHooks`, so
 * until this handler existed a raw write could set `build_status: 'completed'` directly and
 * record a finished production run with no movements, no costs and no variance behind it —
 * the same defect `quote_status` / `invoice_status` / `purchase_order_status` had
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §1), and sharper, because a
 * build is the thing that writes the ledger.
 *
 * ⚠️ **The value here is already coerced, and that is the trap this guard is built to avoid.**
 * By the time `fireFieldPreHooks` runs, `validateAndConvertValue` has turned a SINGLE_SELECT
 * write into `{ type: 'option', optionId: 'completed' }` — it is **never** a bare string on
 * this chain. A guard comparing `event.newValue` to `'completed'` directly is inert: the
 * comparison can never be true, so it passes everything, reads correctly in review and passes
 * any unit test that feeds it a bare string (§2). `unwrapStatusValue`, shared with the
 * system-hook factory, is what makes that unnecessary to remember.
 *
 * ✅ **The five sanctioned writers get through on `bypassFieldGuards`,** which
 * `fireFieldPreHooks` honours before any handler runs. All five write `build_status` through
 * `UnifiedCrudHandler`, whose constructor forwards the set to its internal
 * `FieldValueService`:
 *
 * | writer | file | value |
 * | --- | --- | --- |
 * | `createBuild` | `builds/build-mutations.ts` | `planned` |
 * | `startBuild` | `builds/build-mutations.ts` | `in_progress` |
 * | `cancelBuild` | `builds/build-mutations.ts` | `canceled` |
 * | `completeBuild` | `builds/complete-build.ts` | `completed` |
 * | `reverseBuild` | `builds/reverse-build.ts` | `completed` (on the reversing build's CREATE) |
 *
 * 🛑 That half is not optional. `createBuild` is in the table even though `planned` is not in
 * the guarded set, and `reverseBuild` is in it because the field chain has no
 * `operation === 'create'` exemption — a create carrying a guarded value is refused exactly
 * like an update. Both carry the bypass so the exemption belongs to the sanctioned WRITER
 * rather than to today's value set, the same reasoning that put one on `declineQuote`.
 *
 * ⚠️ **`completeBuild` and `reverseBuild` share their handler with the stock-movement
 * writes,** so those inherit the bypass too. That is safe only because the set names
 * `build_status` and nothing else, and `stock_movement` has no such attribute — the same
 * narrowness that keeps `markQuoteSent`'s mirror write onto `service_request` safe (§7.1).
 * Pinned by a test.
 *
 * 🛑 **There is deliberately no system-hook twin, unlike the other three.** See
 * `resources/hooks/build-hooks.ts` for the argument: `SystemHook`s do not consult
 * `bypassFieldGuards`, and all three build UPDATE writers go through
 * `UnifiedCrudHandler.runPreHooks`, so registering one would refuse Start, Complete and
 * Cancel. It would also add no coverage — those callers write on through to this chain.
 */
export const guardManualBuildLifecycleStatus: FieldPreHookHandler = createFieldLifecycleStatusGuard(
  {
    guardedValues: BUILD_ACTION_STATUSES,
    message: BUILD_ACTION_STATUS_MESSAGE,
  }
)
