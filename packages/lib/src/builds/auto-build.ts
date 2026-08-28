// packages/lib/src/builds/auto-build.ts

/**
 * Phase 3a — an order arrives, and the system raises the builds needed to fulfil
 * it.
 *
 * plans/products/12-order-triggered-build.md section 5.3. The trigger that calls
 * this is declared in `auto-build-rule.ts`; this file is the whole of what it
 * does, so it can be tested without a rule engine.
 *
 * 🛑 **AB1 — an order creates a `build`, not a movement.** The build is a
 * visible, cancellable, costable record that a journal entry can point at. A
 * hidden pair of offsetting movements is what the v9 inventory bridge did, and
 * it is what made a lost movement undetectable.
 *
 * 🛑 **AB5 — every build this raises lands `planned`, and a planned build writes
 * no stock movements** (build README B2). That is the safety property the whole
 * phasing rests on: this can be switched on in an org where not one part has a
 * frozen standard cost, and it still cannot produce a wrong number, because it
 * does not produce a number at all.
 *
 * 🛑 **Never throws** (section 5.3 step 7). One bad line must not lose the rest
 * of the order, and one bad order must not lose the rest of the batch — so every
 * part is attempted inside its own `try`, every order inside its own `try`, and
 * the whole thing is wrapped in the module `guard`. A caller that ignores the
 * returned `Result` is behaving correctly.
 *
 * No permission checks. The rule engine is not an authorization surface, and
 * there is no human in the call stack to check against
 * (`docs/lib-module-guide.md` section 6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { loadDirectSubparts } from '../bom/subpart-graph'
import { SystemUserService } from '../users/system-user-service'
import { isCoveredByStock, isWithinEnablementWindow, sumQuantityByPart } from './auto-build-policy'
import {
  type AutoBuildOrder,
  loadAutoBuildOrders,
  readPartQuantitiesOnHand,
} from './auto-build-queries'
import { loadAutoBuildSettings } from './auto-build-settings'
import { createBuild } from './build-mutations'
import { readPartKinds } from './build-queries'
import { resolvePartKind } from './client'
import { guard } from './guard'

const logger = createScopedLogger('builds:auto-build')

/** Why a candidate did not become a build. Every one of these is normal. */
export type AutoBuildSkipReason =
  /** `inventory.autoBuildFromOrders` is off. */
  | 'disabled'
  /** AB8 — the order was placed before the switch was turned on. */
  | 'before-enablement'
  /** The order arrived already cancelled; phase 3b would only undo the work. */
  | 'order-cancelled'
  /** No line on the order reaches a part through `line_item_part`. */
  | 'no-parts-on-order'
  /** Section 5.3 step 3 — a `component` (or an unclassified part) is purchased, not built. */
  | 'not-a-built-part'
  /** Section 5.3 step 2 — no bill of materials, so a build would consume nothing. */
  | 'no-bill-of-materials'
  /** AB4 — quantity on hand already covers the ordered quantity. */
  | 'covered-by-stock'

/** One candidate the trigger declined, with the reason a person can act on. */
export interface AutoBuildSkip {
  orderId: string | null
  /** `null` for an order-level skip. */
  partId: string | null
  reason: AutoBuildSkipReason
}

/** One build the trigger raised. */
export interface AutoBuildCreation {
  orderId: string
  partId: string
  buildId: string
  quantityPlanned: number
}

/** One candidate that failed. Recorded and stepped over, never thrown. */
export interface AutoBuildFailure {
  orderId: string
  partId: string | null
  message: string
}

/** What one dispatch of the trigger did. */
export interface AutoBuildSummary {
  /** Orders that resolved to a live, non-archived row in this org. */
  ordersConsidered: number
  created: AutoBuildCreation[]
  skipped: AutoBuildSkip[]
  failed: AutoBuildFailure[]
}

function emptySummary(): AutoBuildSummary {
  return { ordersConsidered: 0, created: [], skipped: [], failed: [] }
}

/**
 * Raise the builds a batch of newly created orders needs.
 *
 * The pass, per section 5.3, with the order-level gates hoisted ahead of the
 * per-part ones so a back-filled order costs one comparison instead of a BOM
 * read per line:
 *
 * 1. The switch is on (5.4), or nothing happens at all.
 * 2. The order is inside the enablement window (AB8) and is not itself already
 *    cancelled.
 * 3. Its lines are collapsed to ONE entry per part, quantities summed (step 6).
 * 4. Parts that are not `finished_good` / `subassembly` are dropped (step 3).
 * 5. Parts with no direct subparts are dropped (step 2).
 * 6. Under `out_of_stock_only`, parts already covered by stock are dropped (step 4).
 * 7. What survives becomes one `planned` build per part, stamped with the order
 *    and `source: 'order'` (AB7).
 */
export async function runAutoBuildForOrders(
  db: Database,
  organizationId: string,
  orderIds: string[]
): Promise<Result<AutoBuildSummary, Error>> {
  return guard(
    async () => {
      const summary = emptySummary()
      if (orderIds.length === 0) return summary

      const settings = await loadAutoBuildSettings(organizationId)
      if (!settings.enabled) {
        summary.skipped.push({ orderId: null, partId: null, reason: 'disabled' })
        return summary
      }

      const orders = await loadAutoBuildOrders(db, organizationId, orderIds)
      summary.ordersConsidered = orders.length
      if (orders.length === 0) return summary

      // Order-level gates first, so the batched part reads below only ever cover
      // parts that could still become a build.
      const candidates: { order: AutoBuildOrder; byPart: Map<string, number> }[] = []
      for (const order of orders) {
        if (order.cancelledAt) {
          summary.skipped.push({ orderId: order.orderId, partId: null, reason: 'order-cancelled' })
          continue
        }
        if (!isWithinEnablementWindow(order.placedAt, settings.enabledAt)) {
          summary.skipped.push({
            orderId: order.orderId,
            partId: null,
            reason: 'before-enablement',
          })
          continue
        }
        const byPart = sumQuantityByPart(order.lines)
        if (byPart.size === 0) {
          summary.skipped.push({
            orderId: order.orderId,
            partId: null,
            reason: 'no-parts-on-order',
          })
          continue
        }
        candidates.push({ order, byPart })
      }
      if (candidates.length === 0) return summary

      const partIds = [...new Set(candidates.flatMap(({ byPart }) => [...byPart.keys()]))]
      const [kinds, quantitiesOnHand, systemUserId] = await Promise.all([
        readPartKinds(db, organizationId, partIds),
        readPartQuantitiesOnHand(db, organizationId, partIds),
        // The trigger runs unattended, so it writes as the org's system user —
        // the same actor the rule engine's own `set-field` executor uses.
        SystemUserService.getSystemUserForActions(organizationId),
      ])

      // One BOM read per DISTINCT part across the whole batch, not per order.
      const hasBom = new Map<string, boolean>()
      for (const partId of partIds) {
        // Step 3 before step 2: a `component` never needs its bill of materials read.
        if (resolvePartKind(kinds.get(partId)) === 'component') continue
        const subparts = await loadDirectSubparts(db, organizationId, partId)
        hasBom.set(partId, subparts.length > 0)
      }

      for (const { order, byPart } of candidates) {
        for (const [partId, quantityPlanned] of byPart) {
          try {
            if (resolvePartKind(kinds.get(partId)) === 'component') {
              summary.skipped.push({
                orderId: order.orderId,
                partId,
                reason: 'not-a-built-part',
              })
              continue
            }
            if (!hasBom.get(partId)) {
              summary.skipped.push({
                orderId: order.orderId,
                partId,
                reason: 'no-bill-of-materials',
              })
              continue
            }
            if (
              isCoveredByStock(
                settings.stockRule,
                quantitiesOnHand.get(partId) ?? 0,
                quantityPlanned
              )
            ) {
              summary.skipped.push({ orderId: order.orderId, partId, reason: 'covered-by-stock' })
              continue
            }

            const created = await createBuild(db, organizationId, systemUserId, {
              partId,
              quantityPlanned,
              orderId: order.orderId,
              source: 'order',
            })
            if (created.isErr()) {
              summary.failed.push({
                orderId: order.orderId,
                partId,
                message: created.error.message,
              })
              continue
            }
            summary.created.push({
              orderId: order.orderId,
              partId,
              buildId: created.value.buildId,
              quantityPlanned,
            })
          } catch (error) {
            // 🛑 Step 7. A part that blows up is recorded and stepped over; the
            // rest of the order, and every other order in the batch, still runs.
            summary.failed.push({
              orderId: order.orderId,
              partId,
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }

      if (summary.created.length > 0 || summary.failed.length > 0) {
        logger.info('Auto-build from orders', {
          organizationId,
          orders: summary.ordersConsidered,
          created: summary.created.length,
          skipped: summary.skipped.length,
          failed: summary.failed.length,
        })
      }
      return summary
    },
    'Auto-build from orders failed',
    { organizationId, orders: orderIds.length }
  )
}
