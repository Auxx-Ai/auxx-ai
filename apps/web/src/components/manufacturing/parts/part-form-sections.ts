// apps/web/src/components/manufacturing/parts/part-form-sections.ts

import { isSoldAsIs } from '~/components/drawers/cards/part-sellable-state'
import { isServiceKind } from '~/components/drawers/part-kind-gates'

/** Which stock-only parts of the create form render for a Kind (107 D10). */
export interface PartFormSections {
  product: boolean
  hsCode: boolean
  supplier: boolean
  openingStock: boolean
}

/** A service is never stocked, so it has no family, tariff, supplier or opening balance. */
export function partFormSections(kind: string): PartFormSections {
  const stocked = !isServiceKind(kind)
  return { product: stocked, hsCode: stocked, supplier: stocked, openingStock: stocked }
}

/** What the Sellable switch shows before it is touched: the kind default the lib hook fills. */
export function displayedSellable(kind: string, touched: boolean | null): boolean {
  return touched ?? isSoldAsIs(kind)
}
