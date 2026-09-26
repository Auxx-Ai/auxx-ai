// packages/lib/src/mrp/reads/product-item.ts

import type { Database } from '@auxx/database'
import { daysBetween } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { readOpenBuilds } from '../run/load-inputs'
import { type FamilyVariant, readFamilyVariants } from './family-variants'
import { guard } from './guard'
import { readRecordNames } from './labels'
import { readItems } from './part-item'
import { type ProductTotals, productTotals, rankVariants } from './product-rollup'
import { readOpenIssuedPoLines } from './purchase-orders'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'

export interface ProductVariantItem extends FamilyVariant {
  item: (MrpPlanItemRow & { daysOfCover: number | null }) | null
  hasBom: boolean
  /** `item.adu ÷ Σ adu` over stocked variants; 0 without an item. */
  share: number
  openPoLines: number
  openBuilds: number
}

/** A product family's planning rollup (15 §4.1); sums run over stocked variants only (D38). */
export interface ProductItem {
  run: MrpRunRef | null
  product: { id: string; name: string | null }
  /** Stocked first in run `baseAdu` order, services last. */
  variants: ProductVariantItem[]
  totals: ProductTotals
  flags: Array<{ partId: string; flag: string }>
}

/** The product's variants with their stored run items, live supply counts and family totals. */
export async function readProductItem(
  db: Database,
  organizationId: string,
  input: { productId: string; runId?: string | null }
): Promise<Result<ProductItem, Error>> {
  return guard(
    async () => {
      const { productId } = input
      const [run, variants, names, edges] = await Promise.all([
        loadRun(db, organizationId, input.runId),
        readFamilyVariants(db, organizationId, productId),
        readRecordNames(db, organizationId, 'product', [productId]),
        getOrgCache().get(organizationId, 'subpartEdges'),
      ])
      const stockedIds = variants.filter((v) => v.stocked).map((v) => v.partId)
      const [items, poLines, builds] = await Promise.all([
        run ? readItems(db, organizationId, run.id, stockedIds) : new Map<string, MrpPlanItemRow>(),
        stockedIds.length ? readOpenIssuedPoLines(db, organizationId, stockedIds) : [],
        stockedIds.length ? readOpenBuilds(db, organizationId, new Set(stockedIds)) : [],
      ])

      const parents = new Set((edges ?? []).map((e) => e.parentPartId))
      const count = (ids: readonly string[]) => {
        const out = new Map<string, number>()
        for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1)
        return out
      }
      const lineCount = count(poLines.map((l) => l.partId))
      const buildCount = count(builds.map((b) => b.partId))

      const withItems = variants.map((v) => {
        const item = v.stocked ? items.get(v.partId) : undefined
        return {
          ...v,
          item:
            item && run
              ? {
                  ...item,
                  daysOfCover: item.stockoutDate
                    ? daysBetween(run.asOfDay, item.stockoutDate)
                    : null,
                }
              : null,
        }
      })
      const stocked = rankVariants(
        withItems.filter((v) => v.stocked),
        items
      )
      const services = withItems.filter((v) => !v.stocked)
      const totals = productTotals(stocked)
      const aduSum = stocked.reduce((sum, v) => sum + (v.item?.adu ?? 0), 0)

      return {
        run,
        product: { id: productId, name: names.get(productId) ?? null },
        variants: [...stocked, ...services].map((v) => ({
          ...v,
          hasBom: v.stocked && parents.has(v.partId),
          share: v.item && aduSum > 0 ? (v.item.adu ?? 0) / aduSum : 0,
          openPoLines: lineCount.get(v.partId) ?? 0,
          openBuilds: buildCount.get(v.partId) ?? 0,
        })),
        totals,
        flags: stocked.flatMap((v) =>
          (v.item?.flags ?? []).map((flag) => ({ partId: v.partId, flag }))
        ),
      }
    },
    'Failed to read the plan item for a product',
    { organizationId, productId: input.productId, runId: input.runId }
  )
}
