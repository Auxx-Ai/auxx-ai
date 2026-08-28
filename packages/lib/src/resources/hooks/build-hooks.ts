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
 * No lifecycle guard for `build_status`. Unlike `quote_status` / `invoice_status` /
 * `purchase_order_status`, the build lifecycle is enforced inside the commands that own
 * it — `startBuild` / `completeBuild` / `cancelBuild` all go through `assertBuildStatus`
 * in `builds/build-queries.ts`. That is a different door from this registry, so a raw
 * `record.update` is not walled the way those three attributes are; putting that wall up
 * is its own change, not a side effect of giving the number a writer.
 */
export const BUILD_HOOKS: SystemHookRegistry = {
  build_number: [autoGenerateBuildNumber],
}
