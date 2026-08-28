// packages/lib/src/builds/auto-build-rule.ts

/**
 * The ONE system rule that makes the build entity react to an order.
 *
 * plans/products/12-order-triggered-build.md sections 5.1 (AB2) and 6.2 (AB6).
 *
 * 🛑 **Q13 (plans/products/13 section 4) — there is exactly ONE raise door, and
 * it is not here.** Plan 12's `auto-build-from-order` rule (`on: 'created'`) and
 * the `runAutoBuildForOrders` orchestrator behind it were DELETED in the same
 * change that turned the reconciler's `apply` on. Under Model B the reconciler
 * (`drift-reconciler.ts` -> `reconcileOrderBuilds`) raises, amends and cancels an
 * order's builds, and that job is a strict superset of what the trigger did.
 * Keeping both was not merely redundant: the rule dispatched at sync finalize
 * while the drain runs post-commit of the **same write**, so both could read
 * *"no build exists for this part"* and both raise.
 * `planOrderBuildConvergence` then amends only the OLDEST planned build per pair
 * and marks the rest `duplicate-build` — a **skip, never a cancel** — so the
 * extra build was permanent until a person cancelled it by hand.
 * ⚠️ Do not reintroduce a second door "just for the connector"; plan 13 section
 * 1.6 traces why the drain is reached anyway, and events/08 R6(c) is the right
 * fix for the one lane it is not.
 *
 * What survives is **cancellation**, which is a different concern: it also
 * *reverses* completed builds, and it is deliberately NOT gated on the
 * `inventory.autoBuildFromOrders` switch — an org that turned raising off still
 * has to unwind what was already raised.
 *
 * 🛑 **AB2 — a code-declared system rule, not a managed `RecordRule` row.**
 * Declarations are unioned into the org rule cache at compute time
 * (`record-rules/system-rules.ts`), resolved per org, and dropped for an org
 * that lacks the def or the field. The v9 inventory bridge needed a DB row per
 * org, a provisioning step and a teardown path; this needs none of them.
 *
 * 🛑 **AB3 — `defSlug` is the NATIVE order, never `shopify_orders`.** Only a
 * native `line_item` carries `line_item_part`. The slug used is the def's
 * `apiSlug` (`'orders'`), matching every declaration already shipped: the
 * resolver falls back to the entityType map, so `'order'` would also resolve —
 * but only after `entityDefSlugs` had a chance to match a custom entity that
 * happened to be api-slugged `order`.
 *
 * ⚠️ Section 5.2's door matrix is unchanged and must stay that way: `seed: off`
 * for record rules is correct, because a seeded demo order must not manufacture
 * anything.
 *
 * Top-level imports stay light — the orchestrator pulls `@auxx/database`, the
 * CRUD handler and the BOM graph, so it is lazy-imported inside the wrapper. A
 * static import here would drag all of that into `registerAllHooks()`'s module
 * graph (same rule as `system-entity-rules.ts`).
 */

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import { registerNativeRuleHandler } from '../record-rules/actions'
import type { SystemRuleDeclaration } from '../record-rules/system-rules'
import { declareSystemRules } from '../record-rules/system-rules'

const logger = createScopedLogger('builds:auto-build-rule')

/** Native handler key. Registered here, referenced by the declaration below. */
export const CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED = 'cancelAutoBuildsOnOrderCancelled'

let registered = false

/**
 * Declare the auto-build cancellation system rule and register its native
 * handler. Called from `registerAllHooks()`. Idempotent — safe under repeated
 * init.
 */
export function registerAutoBuildRules(): void {
  if (registered) return
  registered = true

  registerNativeRuleHandler(CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED, async (event) => {
    await runQuietly('cancel auto-builds', event.organizationId, async () => {
      const [{ database }, { cancelAutoBuildsForOrders }] = await Promise.all([
        import('@auxx/database'),
        import('./auto-build-cancel'),
      ])
      const result = await cancelAutoBuildsForOrders(
        database,
        event.organizationId,
        toInstanceIds(event.recordIds)
      )
      if (result.isErr()) throw result.error
    })
  })

  declareSystemRules(AUTO_BUILD_SYSTEM_RULES)
}

/** `<defId>:<instanceId>` -> `instanceId`, which is what the orchestrator takes. */
function toInstanceIds(recordIds: readonly string[]): string[] {
  return recordIds.map((recordId) => parseRecordId(recordId as never).entityInstanceId)
}

/**
 * 🛑 **Section 5.3 step 7 — never throw.**
 *
 * The engine already records a per-action failure and moves on, so a throw here
 * would not lose the order; it would, however, mark the rule run failed for a
 * reason nobody can act on, and it would put a dynamic-import failure on the
 * same footing as a genuine business refusal. The orchestrator already returns a
 * `Result` and isolates each order internally; this is the last wall, and it
 * catches the import itself.
 */
async function runQuietly(
  what: string,
  organizationId: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn()
  } catch (error) {
    logger.error(`${what} failed`, {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The one declaration.
 *
 * 🛑 This list is asserted to have exactly ONE entry
 * (`__tests__/auto-build-rule.test.ts`). That test is the guard against Q13
 * being undone — a second entry here is a second raise door.
 *
 * `assertSystemRuleShape` requires all-native actions and requires a `fieldRef`
 * on a field rule — this satisfies it.
 */
const AUTO_BUILD_SYSTEM_RULES: SystemRuleDeclaration[] = [
  {
    // ⚠️ `on: 'set'` is the intent, but it is not a guarantee. The interactive
    // native-field door dispatches with `oldValue: undefined` and a sentinel new
    // value (`field-hooks/field-hook-job.ts`), so every transition matches there
    // — the handler re-reads `order_cancelled_at` and drops any order that is
    // not actually cancelled.
    key: 'auto-build-cancel-on-order-cancelled',
    name: 'Cancel or reverse the auto-raised builds when an order is cancelled',
    defSlug: 'orders',
    fieldRef: { systemAttribute: 'order_cancelled_at' },
    on: 'set',
    actions: [{ type: 'native', handler: CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED }],
  },
]

/** Test-only: reset the one-time registration latch. */
export function __resetAutoBuildRulesLatch(): void {
  registered = false
}
