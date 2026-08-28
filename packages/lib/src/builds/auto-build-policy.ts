// packages/lib/src/builds/auto-build-policy.ts

/**
 * Every decision the order-triggered auto-build makes that does not need a
 * database: which stock rule is in force, whether a part is already covered,
 * whether an order predates the switch being turned on, and how many units one
 * order really wants of one part.
 *
 * plans/products/12-order-triggered-build.md sections 4 (AB4, AB5, AB8) and 5.3.
 *
 * Pure on purpose. The trigger runs with no human present and its interesting
 * behaviour is entirely in these four answers, so they are testable without a
 * db double, a cache double or a rule engine.
 */

/**
 * Which stock levels an auto-build is raised for.
 *
 * 🛑 **`out_of_stock_only` is the default here and `all_stock_levels` is not**
 * (AB4). Building a lift that is already crated on the shelf gives you two lifts
 * and one order. The competitor this trigger is modelled on ships the unsafe
 * value as the default and puts the safe one behind a paywall, which is
 * backwards.
 */
export type AutoBuildStockRule = 'out_of_stock_only' | 'all_stock_levels'

export const AUTO_BUILD_STOCK_RULES: readonly AutoBuildStockRule[] = [
  'out_of_stock_only',
  'all_stock_levels',
]

/**
 * The status an auto-raised build lands in.
 *
 * 🛑 **`planned` is the only member today, and that is deliberate** (AB5). A
 * `planned` build writes no movements (build README B2), which is the entire
 * reason this trigger can ship before a single standard cost has been rolled.
 * `completed` becomes selectable in phase 4, once `part_kind` is set on the
 * parts that are actually built — until then an auto-complete would abort on
 * its first run, on every order.
 */
export type AutoBuildStatus = 'planned'

export const AUTO_BUILD_STATUSES: readonly AutoBuildStatus[] = ['planned']

/**
 * Read the stored `inventory.autoBuildStockRule` value.
 *
 * Anything unrecognised falls to `out_of_stock_only` rather than throwing: the
 * safe direction, and a trigger is not the place to discover that somebody
 * added a third stock rule.
 */
export function resolveAutoBuildStockRule(raw: unknown): AutoBuildStockRule {
  return raw === 'all_stock_levels' ? 'all_stock_levels' : 'out_of_stock_only'
}

/** Read the stored `inventory.autoBuildStatus` value. See {@link AutoBuildStatus}. */
export function resolveAutoBuildStatus(_raw: unknown): AutoBuildStatus {
  return 'planned'
}

/** One order line, reduced to the only two things the trigger needs from it. */
export interface AutoBuildLine {
  /** `EntityInstance.id` of the `part` the line reaches through `line_item_part`. */
  partId: string
  /** `line_item_qty`. */
  quantity: number
}

/**
 * Collapse an order's lines to ONE entry per part, summing the quantities.
 *
 * 🛑 **This is section 5.3 step 6, and it is the whole of "one build per part,
 * not one per line."** An order with the same lift on two lines must yield one
 * build for the sum — two builds for the same part against the same order look
 * like a duplicate to everyone downstream, and the floor would assemble the
 * batch twice.
 *
 * Lines with a non-positive or non-finite quantity contribute nothing; a part
 * whose lines sum to zero or less is dropped entirely rather than raising a
 * build for nothing.
 */
export function sumQuantityByPart(lines: readonly AutoBuildLine[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const line of lines) {
    if (!line.partId) continue
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue
    totals.set(line.partId, (totals.get(line.partId) ?? 0) + line.quantity)
  }
  for (const [partId, quantity] of totals) {
    if (quantity <= 0) totals.delete(partId)
  }
  return totals
}

/**
 * Under the rule in force, is this part already covered by what is on the shelf?
 *
 * `all_stock_levels` never covers anything — that is what the option means.
 * Under `out_of_stock_only` a part is covered when its quantity on hand already
 * meets the whole ordered quantity.
 *
 * ⚠️ **On-hand, not available-to-promise.** Nothing here reserves stock against
 * other open orders, so two same-day orders for three lifts each against five on
 * the shelf are both read as covered. The rule this copies has the same shape; a
 * real allocation model is a different feature and is not what AB4 asked for.
 */
export function isCoveredByStock(
  rule: AutoBuildStockRule,
  quantityOnHand: number,
  quantityOrdered: number
): boolean {
  if (rule === 'all_stock_levels') return false
  return quantityOnHand >= quantityOrdered
}

/**
 * Coerce a stored `inventory.autoBuildEnabledAt` into a date.
 *
 * The catalog declares the key `DATETIME`, which `normalizeSettingValue` passes
 * through unvalidated (no catalog entry used that field type before), so this
 * has to be defensive about what is actually in the jsonb column.
 */
export function parseAutoBuildEnabledAt(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * AB8 — is this order inside the window the switch has been on for?
 *
 * 🛑 **A missing `enabledAt` reads as OUTSIDE the window, for every order.** The
 * whole point of the stamp is that *a feature which reacts to records must not
 * react to the backlog that existed when it was switched on*; with no recorded
 * boundary there is no way to tell an order placed this morning from one
 * back-filled out of five years of Shopify history, and guessing in the
 * permissive direction fires a build for every historical order at once. The
 * settings write path stamps the timestamp the instant the boolean flips on
 * (`settings/settings-service.ts`), so the only way to reach this branch is an
 * org whose row was written before that existed.
 *
 * The comparison is on the order's *business* date, not the row's creation
 * date: a connector back-fill creates rows today carrying last year's
 * `placedAt`, and that is exactly the case this exists to refuse.
 */
export function isWithinEnablementWindow(orderDate: Date, enabledAt: Date | null): boolean {
  if (!enabledAt) return false
  return orderDate.getTime() >= enabledAt.getTime()
}
