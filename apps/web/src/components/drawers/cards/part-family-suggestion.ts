// apps/web/src/components/drawers/cards/part-family-suggestion.ts

/**
 * Condition logic for the `finished_good` suggestion on the part drawer's
 * Family card (plans/products/01-product-family.md §4).
 *
 * A part that has a `product` and sits at the top of its BOM is almost
 * certainly a finished good — but Gap C §3.2 requires the value human-confirmed
 * and auditable, so this only decides whether to OFFER the one-click chip.
 * Never a derivation, never an auto-write.
 */

/**
 * Whether `part_kind` counts as unset — the "never suggest over an explicit
 * human choice" gate. `useSystemValues` collapses SINGLE_SELECT to a scalar,
 * but stored select values are arrays on other read paths, so both shapes are
 * handled: `null`/`undefined`, `''`, `[]`, and an array whose first entry is
 * empty all read as unset; any concrete value (including an explicit
 * `component`) is a human choice and blocks the suggestion.
 */
export function isPartKindUnset(value: unknown): boolean {
  const first = Array.isArray(value) ? value[0] : value
  return first == null || first === ''
}

interface SuggestFinishedGoodInput {
  /** (a) The part HAS a product — it heads (or belongs to) a family. */
  hasProduct: boolean
  /** (c) Raw `part_kind` value — any set value blocks the suggestion. */
  partKind: unknown
  /**
   * Whether the "is anybody's subpart?" read has actually completed. Until it
   * has, the answer is unknown and the suggestion must not flash on.
   */
  subpartCheckLoaded: boolean
  /**
   * (b) Whether any `subpart` row names this part as its CHILD. Whether the
   * part has its own BOM is deliberately NOT a condition — a spare sold as-is
   * is also a finished good (Gap C §3.2's own example).
   */
  isSubpartOfAssembly: boolean
}

/**
 * ALL required: (a) the part has a product, (b) it is nobody's subpart, and
 * (c) `part_kind` is currently unset.
 */
export function shouldSuggestFinishedGood(input: SuggestFinishedGoodInput): boolean {
  if (!input.hasProduct) return false
  if (!isPartKindUnset(input.partKind)) return false
  if (!input.subpartCheckLoaded) return false
  return !input.isSubpartOfAssembly
}
