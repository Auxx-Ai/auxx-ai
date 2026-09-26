// packages/lib/src/mrp/reads/product-sell-through.ts

import type { Database } from '@auxx/database'
import { addDaysToDayKey, type DayKey, todayInZone } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { getOrgCache } from '../../cache'
import { readDailyActivity, readDailySeries } from '../../inventory/movements/fact/reads'
import { readFamilyVariants } from './family-variants'
import { guard } from './guard'
import { readPartLabels, readRecordNames } from './labels'
import { readItems, walkBom } from './part-item'
import { familyUnbuilt, pickFamilyLimiting } from './product-rollup'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'
import { type LimitingPart, SELL_THROUGH_DAYS } from './sell-through'

/** The family's sell-through over the union of its stocked variants' BOMs (15 §4.3, D42). */
export interface ProductSellThrough {
  run: MrpRunRef | null
  window: { from: DayKey; to: DayKey }
  /** Stocked variants with at least one subpart. */
  withBom: number
  stocked: number
  /** `sale` + `ship` over the window, summed across stocked variants. */
  sold: number
  /** `build_produce` over the window, summed across stocked variants. */
  built: number
  /** Σ per variant of `sold − built − max(0, opening)`, each floored at 0. */
  unbuilt: number
  limiting: (LimitingPart & { variantCount: number }) | null
}

/** A product family's 30-day sold/built signal and the part limiting it across every variant's BOM. */
export async function readProductSellThrough(
  db: Database,
  organizationId: string,
  input: { productId: string; runId?: string | null }
): Promise<Result<ProductSellThrough, Error>> {
  return guard(
    async () => {
      const [run, zone, edges, variants] = await Promise.all([
        loadRun(db, organizationId, input.runId),
        readBookTimeZoneOrUtc(organizationId),
        getOrgCache().get(organizationId, 'subpartEdges'),
        readFamilyVariants(db, organizationId, input.productId),
      ])
      const stockedIds = variants.filter((v) => v.stocked).map((v) => v.partId)
      const trees = stockedIds
        .map((id) => walkBom(id, edges ?? []))
        .filter((tree) => tree.length > 0)
      const unionIds = [...new Set(trees.flat().map((n) => n.partId))]
      const to = run?.asOfDay ?? todayInZone(zone)
      const from = addDaysToDayKey(to, -(SELL_THROUGH_DAYS - 1))

      const [activity, openingDay, items] = await Promise.all([
        readDailyActivity(db, organizationId, { partIds: stockedIds, from, to, zone }),
        readDailySeries(db, organizationId, { partIds: stockedIds, from, to: from, zone }),
        run && unionIds.length
          ? readItems(db, organizationId, run.id, unionIds)
          : new Map<string, MrpPlanItemRow>(),
      ])
      if (activity.isErr()) throw activity.error
      if (openingDay.isErr()) throw openingDay.error

      const perVariant = new Map(stockedIds.map((id) => [id, { sold: 0, built: 0, opening: 0 }]))
      for (const a of activity.value) {
        const v = perVariant.get(a.partId)
        if (!v) continue
        v.sold += a.saleQty
        v.built += a.produceQty
      }
      for (const d of openingDay.value) {
        const v = perVariant.get(d.partId)
        if (v) v.opening = d.onHandEod - d.net
      }
      const totals = [...perVariant.values()]

      const picked = pickFamilyLimiting(trees, items)
      const limitingItem = picked ? items.get(picked.node.partId) : undefined
      const supplierId = limitingItem?.suggestedSupplierId ?? null
      const [labels, supplierNames] = await Promise.all([
        picked
          ? readPartLabels(db, organizationId, [picked.node.partId])
          : new Map<string, { name: string | null }>(),
        supplierId
          ? readRecordNames(db, organizationId, 'company', [supplierId])
          : new Map<string, string | null>(),
      ])

      return {
        run,
        window: { from, to },
        withBom: trees.length,
        stocked: stockedIds.length,
        sold: totals.reduce((sum, v) => sum + v.sold, 0),
        built: totals.reduce((sum, v) => sum + v.built, 0),
        unbuilt: familyUnbuilt(totals),
        limiting:
          picked && limitingItem?.stockoutDate
            ? {
                partId: picked.node.partId,
                name: labels.get(picked.node.partId)?.name ?? null,
                stockoutDate: limitingItem.stockoutDate,
                orderByDate: limitingItem.orderByDate,
                isOverdue: limitingItem.isOverdue,
                supplier: supplierId
                  ? { id: supplierId, name: supplierNames.get(supplierId) ?? null }
                  : null,
                variantCount: picked.variantCount,
              }
            : null,
      }
    },
    'Failed to read sell-through for a product',
    { organizationId, productId: input.productId, runId: input.runId }
  )
}
