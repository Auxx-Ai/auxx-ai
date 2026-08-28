// packages/lib/src/resources/hooks/build-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-generate the build number on create. Mirrors autoGenerateOrderNumber /
 * autoGeneratePurchaseOrderNumber.
 *
 * `build_number` has creatable:false/updatable:false and `build` declares
 * `primaryDisplayField: 'number'`, so this hook is the ONLY writer and without it
 * every build renders nameless (plans/products/build/01-build-plan.md section 1.1 —
 * `B-0001`, RecordSequence scope `build`).
 *
 * 🛑 Issued exactly once per build, and that rests on three things together:
 * - `operation !== 'create'` returns early, so an update never re-enters the counter.
 *   `UnifiedCrudHandler.runPreHooks` runs every registered hook on CREATE regardless of
 *   whether the attribute is in `values`, but on UPDATE only when it is — this guard is
 *   what covers the create-then-update case where a caller does pass the attribute.
 * - `createBuild` performs exactly one `UnifiedCrudHandler.create` per build, so the
 *   create door is entered once.
 * - `recordNumbering.create` increments and reads back in a single UPDATE ... RETURNING,
 *   so two concurrent creates cannot be handed the same number.
 */
const autoGenerateBuildNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'build')
  return { ...values, [field.id]: recordNumber }
}

/**
 * `build` system hooks: the RecordSequence number on create, and nothing else.
 *
 * 🛑 **`build_status` IS walled now, and deliberately NOT here.** Its guard lives on the
 * FIELD pre-hook chain only — `field-hooks/pre/build-status-guard.ts`, registered against
 * `('builds', 'build_status')`. That is a departure from `quote_status` / `invoice_status` /
 * `purchase_order_status`, which carry the guard on both chains, and the reason is
 * mechanical rather than a matter of taste:
 *
 * 1. **A system hook cannot be bypassed.** `UnifiedCrudHandler.runPreHooks` consults no
 *    equivalent of `bypassFieldGuards` — the exemption exists only on the field chain
 *    (`fireFieldPreHooks`). The money writers never collide with that because they write
 *    status through `FieldValueService` directly and so never enter this registry at all.
 *    **The build writers do not**: `startBuild`, `cancelBuild` and `completeBuild` each write
 *    `build_status` through `UnifiedCrudHandler.update`, which runs every hook registered
 *    here. A twin would therefore refuse the three actions it was built to protect — trap 2
 *    of plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4, arriving through a
 *    chain that has no way to answer it.
 * 2. **It would add no coverage.** The doors a system hook is kept for — `record.create` /
 *    `record.update`, the CSV importer, the SDK — all reach the field values through
 *    `UnifiedCrudHandler.setFieldValues` -> `FieldValueService` -> `fireFieldPreHooks` with
 *    an empty bypass set, so the field guard already sees them. The system twin's one
 *    distinguishing behaviour is its `operation === 'create'` exemption, which makes it
 *    strictly weaker, not additive.
 *
 * The transition MATRIX still lives where it always did — `assertBuildStatus` in
 * `builds/build-queries.ts`, against `canStartBuild` / `canCompleteBuild` / `canCancelBuild`
 * / `canReverseBuild`. The field guard does not duplicate it; it only stops a manual write
 * from routing around it.
 */
export const BUILD_HOOKS: SystemHookRegistry = {
  build_number: [autoGenerateBuildNumber],
}
