// apps/web/src/components/drawers/cards/part-sellable-state.ts

/**
 * Derivation logic for the part drawer's Pricing card
 * (plans/products/01-product-family.md §6.1).
 *
 * "Sellable" is DERIVED, never stored: a part is sellable iff an ACTIVE
 * `catalog_item` backs it. A stored `part_sellable` boolean was considered and
 * rejected — it would be a second copy of a fact the catalog item already
 * carries, able to disagree with it.
 */

import { PartKind } from '@auxx/lib/resources/client'

/** One backing catalog item's card-relevant facts, values already resolved. */
export interface SellableCatalogItem {
  /** EntityInstance id. */
  id: string
  name?: string
  /** `catalog_item_active` — a missing value reads as the registry default, true. */
  active: boolean
  /** `catalog_item_default_unit_price`, minor units. */
  priceCents: number | null
}

export type SellableCardState =
  /** Nothing to show — reads still loading, or no catalog item and not a finished good. */
  | { kind: 'hidden' }
  /**
   * Finished good with no catalog item at all: the empty state renders
   * prominently ("no price set") and checking the toggle CREATES the backing
   * item inline. Other kinds render nothing instead — a raw material's drawer
   * stays clean.
   */
  | { kind: 'offer' }
  /**
   * Exactly one catalog item: the Sellable toggle. Checked iff the item is
   * active; unchecking writes `catalog_item_active = false` (never a delete —
   * quotes and line items reference it), re-checking flips it back with the
   * price preserved. `showNudge` marks the finished-good-but-inactive case.
   */
  | { kind: 'toggle'; item: SellableCatalogItem; showNudge: boolean }
  /**
   * Multiple catalog items (the edge is has_many — price tiers): no toggle,
   * render the compact list. That merchant opted into catalog complexity.
   */
  | { kind: 'list'; items: SellableCatalogItem[] }

/**
 * Whether `part_kind` reads as `finished_good`. SINGLE_SELECT values are
 * arrays on some read paths and scalars on others — both shapes are handled.
 */
export function isFinishedGood(partKind: unknown): boolean {
  const first = Array.isArray(partKind) ? partKind[0] : partKind
  return first === PartKind.FINISHED_GOOD
}

interface DeriveSellableCardStateInput {
  /**
   * Whether the catalog-item list AND each item's `catalog_item_active` have
   * actually been read. Until then the answer is unknown and nothing may
   * render — an unchecked toggle flashing at a sellable part is a lie.
   */
  loaded: boolean
  /** Catalog items whose `catalog_item:part` relation names this part. */
  items: SellableCatalogItem[]
  /** Raw `part_kind` value — drives only the nudge, never the derivation (§6.1). */
  partKind: unknown
}

/** Pick the card's state from the backing catalog items and `part_kind`. */
export function deriveSellableCardState(input: DeriveSellableCardStateInput): SellableCardState {
  if (!input.loaded) return { kind: 'hidden' }

  if (input.items.length === 0) {
    // Only the finished-good case surfaces: for a finished good, no price is
    // almost certainly an omission. Everything else renders nothing.
    return isFinishedGood(input.partKind) ? { kind: 'offer' } : { kind: 'hidden' }
  }

  if (input.items.length > 1) return { kind: 'list', items: input.items }

  const item = input.items[0] as SellableCatalogItem
  return {
    kind: 'toggle',
    item,
    showNudge: !item.active && isFinishedGood(input.partKind),
  }
}
