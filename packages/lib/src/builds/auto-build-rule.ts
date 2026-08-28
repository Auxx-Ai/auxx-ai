// packages/lib/src/builds/auto-build-rule.ts

/**
 * The two system rules that make the build entity react to an order.
 *
 * plans/products/12-order-triggered-build.md sections 5.1 (AB2) and 6.2 (AB6).
 *
 * 🛑 **AB2 — code-declared system rules, not managed `RecordRule` rows.**
 * Declarations are unioned into the org rule cache at compute time
 * (`record-rules/system-rules.ts`), resolved per org, and dropped for an org
 * that lacks the def or the field. The v9 inventory bridge needed a DB row per
 * org, a provisioning step and a teardown path; this needs none of them.
 *
 * ⚠️ Contrary to plan 12 section 5.1, `declarations` was NOT empty when this was
 * written — `field-hooks/system-entity-rules.ts` and
 * `field-hooks/system-record-rules.ts` already declare nine lifecycle and seven
 * field system rules between them, including the live
 * `mfg-stock-movements-created`. These two follow that shipped shape exactly
 * rather than inventing one.
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
 * Top-level imports stay light — the two orchestrators pull `@auxx/database`,
 * the CRUD handler and the BOM graph, so they are lazy-imported inside the
 * wrappers. A static import here would drag all of that into
 * `registerAllHooks()`'s module graph (same rule as `system-entity-rules.ts`).
 */

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import { registerNativeRuleHandler } from '../record-rules/actions'
import type { SystemRuleDeclaration } from '../record-rules/system-rules'
import { declareSystemRules } from '../record-rules/system-rules'

const logger = createScopedLogger('builds:auto-build-rule')

/** Native handler keys. Registered here, referenced by the declarations below. */
export const AUTO_BUILD_FROM_ORDER = 'autoBuildFromOrder'
export const CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED = 'cancelAutoBuildsOnOrderCancelled'

let registered = false

/**
 * Declare the two auto-build system rules and register their native handlers.
 * Called from `registerAllHooks()`. Idempotent — safe under repeated init.
 */
export function registerAutoBuildRules(): void {
  if (registered) return
  registered = true

  registerNativeRuleHandler(AUTO_BUILD_FROM_ORDER, async (event) => {
    // Lifecycle rule: `deleted` never reaches this declaration, but a native
    // handler is keyed by name and could in principle be reused, so be explicit.
    if (event.action !== 'created') return
    await runQuietly('auto-build from order', event.organizationId, async () => {
      const [{ database }, { runAutoBuildForOrders }] = await Promise.all([
        import('@auxx/database'),
        import('./auto-build'),
      ])
      const result = await runAutoBuildForOrders(
        database,
        event.organizationId,
        toInstanceIds(event.recordIds)
      )
      if (result.isErr()) throw result.error
    })
  })

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

/** `<defId>:<instanceId>` -> `instanceId`, which is what the orchestrators take. */
function toInstanceIds(recordIds: readonly string[]): string[] {
  return recordIds.map((recordId) => parseRecordId(recordId as never).entityInstanceId)
}

/**
 * 🛑 **Section 5.3 step 7 — never throw.**
 *
 * The engine already records a per-action failure and moves on, so a throw here
 * would not lose the order; it would, however, mark the rule run failed for a
 * reason nobody can act on, and it would put a dynamic-import failure on the
 * same footing as a genuine business refusal. Both orchestrators already return
 * a `Result` and isolate each order and each part internally; this is the last
 * wall, and it catches the import itself.
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
 * The two declarations.
 *
 * `assertSystemRuleShape` requires all-native actions, forbids a `fieldRef` on a
 * lifecycle rule and requires one on a field rule — both of these satisfy it.
 */
const AUTO_BUILD_SYSTEM_RULES: SystemRuleDeclaration[] = [
  {
    key: 'auto-build-from-order',
    name: 'Build finished goods when an order is created',
    defSlug: 'orders',
    on: 'created',
    actions: [{ type: 'native', handler: AUTO_BUILD_FROM_ORDER }],
  },
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
