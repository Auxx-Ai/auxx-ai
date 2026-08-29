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
 * Whether `part_kind` counts as unset. `useSystemValues` collapses SINGLE_SELECT
 * to a scalar, but stored select values are arrays on other read paths, so both
 * shapes are handled: `null`/`undefined`, `''`, `[]`, and an array whose first
 * entry is empty all read as unset.
 *
 * ⚠️ This is no longer the whole suggestion gate. `part_kind` now carries
 * `defaultValue: 'component'` (part-fields.ts, 15-costing-usability.md §4c), so
 * a stored `component` no longer proves a human chose it. See
 * {@link isPartKindUnclassified}, which is what the suggestion gates on.
 */
export function isPartKindUnset(value: unknown): boolean {
  const first = Array.isArray(value) ? value[0] : value
  return first == null || first === ''
}

/**
 * Whether `part_kind` still reads as "nobody has said what this part is":
 * unset, **or** the `component` the field now defaults to.
 *
 * 🛑 Why `component` counts. The old rule was "any concrete value (including an
 * explicit `component`) is a human choice and blocks the suggestion", and its
 * premise was that `component` only ever got there because somebody typed it.
 * Defaulting `part_kind` to `component` falsifies that premise: after
 * 15-costing-usability.md §4c it means "nobody said otherwise". Left alone, the
 * gate would go quiet on exactly the parts it exists for, and a finished good
 * sitting on the default posts to `1310` instead of `1330` and freezes that on
 * `updatable: false` movement rows that can never be corrected.
 *
 * So the suggestion stops being "fill in the blank" and becomes "this looks
 * misclassified", which also catches imported, seeded and API-created parts that
 * the unset-only gate never could. `subassembly` and `finished_good` still block
 * it: neither is reachable without somebody picking it.
 */
export function isPartKindUnclassified(value: unknown): boolean {
  const first = Array.isArray(value) ? value[0] : value
  return first == null || first === '' || first === 'component'
}

interface SuggestFinishedGoodInput {
  /** (a) The part HAS a product — it heads (or belongs to) a family. */
  hasProduct: boolean
  /**
   * (c) Raw `part_kind` value. Unset or `component` (the field default) leaves
   * the suggestion open; `subassembly` and `finished_good` block it.
   */
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
 * (c) `part_kind` is unclassified: unset, or the defaulted `component`.
 *
 * (a) and (b) are unchanged. Only (c) widened; see
 * {@link isPartKindUnclassified} for why.
 */
export function shouldSuggestFinishedGood(input: SuggestFinishedGoodInput): boolean {
  if (!input.hasProduct) return false
  if (!isPartKindUnclassified(input.partKind)) return false
  if (!input.subpartCheckLoaded) return false
  return !input.isSubpartOfAssembly
}

interface SuggestFamilyInput {
  /** Whether the part has a `product` relation. */
  hasProduct: boolean
  /** Raw `part_kind` value. */
  partKind: unknown
}

/**
 * The inverse suggestion (plans/products/09-variant-ui.md §6): a part the human
 * has ALREADY classified as a finished good, sitting in no product family.
 *
 * The card renders nothing at all for a part with no family, which is right for
 * a 2x4 stud and wrong for a finished good — a finished good is, by definition,
 * the thing a family is a family of. Without this there is no route into a
 * family from the part side either; the user has to know products exist and go
 * find the Product field in the Details panel.
 *
 * Note the symmetry with {@link shouldSuggestFinishedGood}, which is why the two
 * can never fire together: that one only speaks while the kind is unclassified,
 * this one only speaks once it says `finished_good`, and `finished_good` is
 * never in the unclassified set. It is required explicitly and never inferred,
 * the same Gap C §3.2 rule. (They also disagree on `hasProduct`, so the two
 * conditions are doubly exclusive.)
 */
export function shouldSuggestFamily(input: SuggestFamilyInput): boolean {
  if (input.hasProduct) return false
  const first = Array.isArray(input.partKind) ? input.partKind[0] : input.partKind
  return first === 'finished_good'
}
