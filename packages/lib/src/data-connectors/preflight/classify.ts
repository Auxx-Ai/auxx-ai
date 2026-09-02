// packages/lib/src/data-connectors/preflight/classify.ts
// Pure classification — item 2 of the duplicate-SKU adoption pre-flight
// (plans/money/design/duplicate-sku-preflight.md §6.1, report contract §5, test
// plan §9). No db access: takes the swept variants and the existing parts
// already looked up by SKU (`lookup.ts`), and answers what would happen to
// each variant if the connector adopted right now.

import type { SweptVariant } from './sweep'

/**
 * One row class per the design's §5 report contract, plus one the design left
 * undecided (§8 lists no open item for it explicitly, but §5's table only has
 * four rows and none of them is "matches an archived part" — the design's own
 * §9 test-plan row for that case says "Undecided — resolve before building").
 *
 * `matched_archived` is the resolution this module makes: an archived part is
 * never a silent match. Archiving is how this codebase discards a part without
 * deleting it, and adopting a live Shopify variant onto a record a human
 * archived would resurrect it under the merchant's back — worse than creating
 * a duplicate, because a duplicate is at least visible. Treated as blocking,
 * same as `ambiguous`.
 */
export type VariantClass = 'matched' | 'matched_archived' | 'create' | 'ambiguous' | 'blank'

/** An existing part, as looked up by `findPartsBySkus` — including archived ones. */
export interface ExistingPart {
  id: string
  sku: string
  archivedAt: Date | null
  displayName: string
}

/** One classified row — the swept variant plus its verdict. */
export interface ClassifiedVariant extends SweptVariant {
  class: VariantClass
  /** Set only for `matched` / `matched_archived` — the part this variant would merge into. */
  matchedPartId: string | null
  /** Set only for `matched` / `matched_archived` — so the report can name it (design §7). */
  matchedPartName: string | null
}

/** One SKU two or more variants share, named so the report can list the offending variants (design §7). */
export interface AmbiguousSku {
  sku: string
  variantIds: string[]
}

/** The report's summary — enough to decide "refuse to enable the match key" (design §7) without re-scanning `rows`. */
export interface ClassificationSummary {
  /** True when enabling the SKU match key must be refused: any `ambiguous` or `matched_archived` row. */
  blocking: boolean
  counts: Record<VariantClass, number>
  ambiguousSkus: AmbiguousSku[]
}

export interface ClassifyVariantsResult {
  rows: ClassifiedVariant[]
  summary: ClassificationSummary
}

/**
 * Classify every swept variant against the existing parts a prior SKU lookup
 * found.
 *
 * **Normalization: trim only, never lowercase.** The production write path's
 * own uniqueness guard (`migration 097-part-sku-unique`) compares
 * `valueText` with a bare, case-sensitive `eq` — it does not even trim. This
 * function trims (a leading/trailing space is almost always a data-entry
 * accident, and treating `"LIFT-3000"` and `"LIFT-3000 "` as the same SKU for
 * the purpose of a merchant-facing duplicate report is the conservative
 * choice) but stops there: lowercasing would flag `sku` vs `SKU` as duplicates
 * when the write path's own constraint would happily create both, which would
 * make this report MORE restrictive than the system it is gating and block
 * stores that were never actually at risk.
 *
 * Blank handling mirrors design §3: `null`, `''`, and whitespace-only all
 * normalize to "no SKU" and classify as `blank`, never `ambiguous` — two
 * blank-SKU variants are not a collision, because a blank never matches
 * anything (the same guard `resolveIdentity` already applies at sync time).
 *
 * @param variants - Every variant the sweep found, across the whole catalog.
 * @param existingParts - Every existing part (including archived) whose SKU
 *   matches at least one swept variant's trimmed SKU — from `findPartsBySkus`.
 */
export function classifyVariants(
  variants: SweptVariant[],
  existingParts: ExistingPart[]
): ClassifyVariantsResult {
  const variantsBySku = new Map<string, SweptVariant[]>()
  for (const variant of variants) {
    const sku = normalizeSku(variant.sku)
    if (sku === null) continue
    const siblings = variantsBySku.get(sku)
    if (siblings) siblings.push(variant)
    else variantsBySku.set(sku, [variant])
  }

  const partsBySku = new Map<string, ExistingPart[]>()
  for (const part of existingParts) {
    const sku = normalizeSku(part.sku)
    if (sku === null) continue
    const matches = partsBySku.get(sku)
    if (matches) matches.push(part)
    else partsBySku.set(sku, [part])
  }

  const counts: Record<VariantClass, number> = {
    matched: 0,
    matched_archived: 0,
    create: 0,
    ambiguous: 0,
    blank: 0,
  }
  const rows: ClassifiedVariant[] = []

  for (const variant of variants) {
    const sku = normalizeSku(variant.sku)

    if (sku === null) {
      counts.blank += 1
      rows.push({ ...variant, class: 'blank', matchedPartId: null, matchedPartName: null })
      continue
    }

    const siblings = variantsBySku.get(sku) ?? []
    if (siblings.length > 1) {
      counts.ambiguous += 1
      rows.push({ ...variant, class: 'ambiguous', matchedPartId: null, matchedPartName: null })
      continue
    }

    const matches = partsBySku.get(sku) ?? []
    const live = matches.find((part) => part.archivedAt === null)
    if (live) {
      counts.matched += 1
      rows.push({
        ...variant,
        class: 'matched',
        matchedPartId: live.id,
        matchedPartName: live.displayName,
      })
      continue
    }

    const archived = matches[0]
    if (archived) {
      counts.matched_archived += 1
      rows.push({
        ...variant,
        class: 'matched_archived',
        matchedPartId: archived.id,
        matchedPartName: archived.displayName,
      })
      continue
    }

    counts.create += 1
    rows.push({ ...variant, class: 'create', matchedPartId: null, matchedPartName: null })
  }

  const ambiguousSkus: AmbiguousSku[] = []
  for (const [sku, siblings] of variantsBySku) {
    if (siblings.length > 1) {
      ambiguousSkus.push({ sku, variantIds: siblings.map((v) => v.variantId) })
    }
  }

  return {
    rows,
    summary: {
      blocking: counts.ambiguous > 0 || counts.matched_archived > 0,
      counts,
      ambiguousSkus,
    },
  }
}

/** Trim-only normalization (see the JSDoc above for why not lowercase). Blank ⇒ null. */
function normalizeSku(sku: string | null): string | null {
  const trimmed = sku?.trim()
  return trimmed ? trimmed : null
}
