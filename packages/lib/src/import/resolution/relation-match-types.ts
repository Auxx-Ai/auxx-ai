// packages/lib/src/import/resolution/relation-match-types.ts

import { BaseType } from '../../resources/types'

/**
 * The four buckets `queryCustomEntity` branches on, one per typed `FieldValue`
 * column. They live here rather than inline in `resolve-relation-lookups.ts`
 * so the wizard's match-field picker can filter against the SAME values the
 * resolver switches on, a client bundle cannot import the resolver (it pulls
 * `@auxx/database`), and restating the list in the component is exactly how the
 * two drifted apart in the first place (03 §5.4).
 *
 * `resolve-relation-lookups.ts` imports these arrays and uses them directly in
 * its branches, and re-exports {@link RELATION_MATCHABLE_BASE_TYPES}, so the
 * set cannot describe a branch that isn't there.
 */

/** TEXT lane, matched with `LOWER(FieldValue.valueText)`. */
export const RELATION_MATCH_TEXT_TYPES = [
  BaseType.STRING,
  BaseType.EMAIL,
  BaseType.URL,
  BaseType.PHONE,
] as const

/** NUMERIC lane, matched with `FieldValue.valueNumber`. */
export const RELATION_MATCH_NUMERIC_TYPES = [BaseType.NUMBER] as const

/** ENUM lane, matched with `LOWER(FieldValue.optionId)`. */
export const RELATION_MATCH_ENUM_TYPES = [BaseType.ENUM] as const

/** ARRAY lane, multi-row `optionId` storage, matched the same way as ENUM. */
export const RELATION_MATCH_ARRAY_TYPES = [BaseType.TAGS, BaseType.ARRAY] as const

/**
 * Every `BaseType` a relation match field may legally have.
 *
 * This is a **technical** limit, what `queryCustomEntity` can actually
 * query, and is deliberately NOT the identifier-eligibility gate, which is a
 * *policy* question answered by `getIdentifiableFields`. Merging the two would
 * either offer relation match fields that can never match (`DATETIME`,
 * `BOOLEAN`, `DATE`, `part.createdAt` is `filterable`, so the picker offers
 * **Created** today and it silently matches nothing, forever) or refuse
 * identifier types that work fine.
 */
export const RELATION_MATCHABLE_BASE_TYPES: ReadonlySet<BaseType> = new Set<BaseType>([
  ...RELATION_MATCH_TEXT_TYPES,
  ...RELATION_MATCH_NUMERIC_TYPES,
  ...RELATION_MATCH_ENUM_TYPES,
  ...RELATION_MATCH_ARRAY_TYPES,
])

/**
 * Whether a field of this type can be used as a relation match field.
 *
 * Accepts a bare string so callers holding an untyped `field.type` (the
 * resource-fields hook in the wizard) don't have to cast, `BaseType` is a
 * string enum, so the comparison is value-identical.
 *
 * @param type - The candidate field's `BaseType` (or its string value)
 * @returns true when {@link RELATION_MATCHABLE_BASE_TYPES} contains it
 */
export function isRelationMatchableType(type: BaseType | string | null | undefined): boolean {
  if (!type) return false
  return RELATION_MATCHABLE_BASE_TYPES.has(type as BaseType)
}
