// apps/web/src/components/drawers/cards/part-sellable-state.ts

import { PartKind } from '@auxx/lib/resources/client'

/** First element of a SINGLE_SELECT value, which some read paths return as an array. */
function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

/** Kinds sold as they are, where a missing price is almost certainly an omission (107 D3). */
export function isSoldAsIs(partKind: unknown): boolean {
  const kind = firstValue(partKind)
  return kind === PartKind.FINISHED_GOOD || kind === PartKind.SERVICE
}

interface PricingCardInput {
  partKind: unknown
  sellable: boolean
  priceCents: number | null
  markup: number | null
  /** A live connector binding writes `part_sell_price` (107 D11). */
  connectorPriced: boolean
}

export interface PricingCardState {
  /** Price, markup, taxable and cost rows render. */
  showPricing: boolean
  /** The price is a hand-editable input; false when the connector owns it. */
  priceEditable: boolean
  /** Markup applies: markup and following the channel exclude each other. */
  showMarkup: boolean
  /** The price is computed from cost and markup. */
  autoPriced: boolean
  nudge: 'not-sellable' | 'no-price' | null
}

/** Pick what the part drawer's Pricing card shows from the part's own selling fields. */
export function derivePricingCardState(input: PricingCardInput): PricingCardState {
  const soldAsIs = isSoldAsIs(input.partKind)
  const showMarkup = input.sellable && !input.connectorPriced

  let nudge: PricingCardState['nudge'] = null
  if (soldAsIs && !input.sellable) nudge = 'not-sellable'
  else if (input.sellable && input.priceCents === null) nudge = 'no-price'

  return {
    showPricing: input.sellable,
    priceEditable: !input.connectorPriced,
    showMarkup,
    autoPriced: showMarkup && input.markup !== null,
    nudge,
  }
}
