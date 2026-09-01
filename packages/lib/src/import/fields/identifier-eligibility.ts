// packages/lib/src/import/fields/identifier-eligibility.ts

import { getFieldOutputKey, type ResourceField } from '../../resources/registry/field-types'
import { BaseType } from '../../resources/types'

/**
 * How strongly a field is recommended as an import match key.
 *
 * - `1`, **Recommended.** The field is enforced unique, or the registry
 *   declares it an identifier. Re-importing a file keyed on one of these is
 *   safe by construction.
 * - `2`, **Available.** An eligible field that carries no uniqueness
 *   guarantee. Offered anyway, with {@link IdentifierEligibility.note} rendered
 *   inline, because restricting the picker to unique fields fails OPEN: a user
 *   who cannot pick a match key imports create-only and gets exactly the
 *   duplicates the restriction was meant to prevent. `(part, supplier)` on
 *   `vendor_part` is two non-unique relations and is the correct identity.
 */
export type IdentifierTier = 1 | 2

/** Why a field is offered as a match key, and with what caveat. */
export interface IdentifierEligibility {
  tier: IdentifierTier
  /**
   * `true` for `RELATION` fields: eligible only as part of a COMPOSITE key,
   * never as the lone identifier. A single relation column rarely identifies a
   * record and always reads as a mistake when it does. The UI enforces this;
   * nothing downstream depends on it.
   */
  compositeOnly: boolean
  /** Inline caveat for the picker. Present on tier 2 only. */
  note?: string
}

/**
 * ENUM is not an identifier type in general - "which ticket has status Open" is
 * every ticket. It is admitted for ONE case: a field the registry declares a
 * leg of a composite natural key.
 *
 * `tariff_code` is what forced it. Its identity is `(code, country)` and
 * `country` is a seeded `SINGLE_SELECT` over ISO 3166-1 rather than free text,
 * precisely so two people cannot fork the key by spelling the United Kingdom
 * `UK` and `GB`. Excluding ENUM outright left that key declared in the registry
 * and undeclarable in the picker - the import would key on `code` alone and
 * collapse `8481.80.9005 CN` onto `8481.80.9005 DE`, which is the exact
 * silent fork the closed option set exists to prevent.
 *
 * The stored value is an option key, so the lookup matches it like any other
 * scalar; the general exclusion is a POLICY about bad identities, and a
 * declared key leg is by definition not one.
 */
function isNaturalKeyLeg(field: ResourceField): boolean {
  return field.naturalKeyPosition !== undefined
}

/** An ENUM admitted by the rule on {@link isNaturalKeyLeg}, and nothing else. */
function isEligibleEnumLeg(field: ResourceField): boolean {
  return field.type === BaseType.ENUM && isNaturalKeyLeg(field)
}

/**
 * The IDENTIFIER type gate. Policy, not a technical limit.
 *
 * The identifier lookup is fully type-generic, `buildLookupCondition` routes
 * every type through `normalizeForLookup` → `createTypedValueInput`, so
 * `CURRENCY` and `DATE` *would* match if they were offered. They are excluded
 * because they are terrible identities, not because they cannot work.
 *
 * Do NOT merge this with the RELATION match-field gate in `queryCustomEntity`.
 * That one is a real technical limit (its hand-rolled type switch supports only
 * STRING/EMAIL/URL/PHONE, NUMBER, ENUM and TAGS/ARRAY). Two different questions;
 * a merged constant would either offer relation match fields that can never
 * match, or refuse identifier types that work fine.
 */
const ELIGIBLE_IDENTIFIER_TYPES: ReadonlySet<string> = new Set<string>([
  BaseType.STRING,
  BaseType.EMAIL,
  BaseType.URL,
  BaseType.PHONE,
  BaseType.NUMBER,
  BaseType.RELATION,
])

/**
 * Output keys that are identifiers by nature even when the registry forgets to
 * say so. `id` is the record's primary key; `externalId` is the upstream one.
 */
const INTRINSIC_IDENTIFIER_KEYS: ReadonlySet<string> = new Set(['id', 'externalId'])

/** The note rendered beside a tier-2 field in the picker. */
export const TIER_2_IDENTIFIER_NOTE = 'Not enforced unique'

/** True when the field is derived from other fields and cannot be set directly. */
function isComputed(field: ResourceField): boolean {
  return field.capabilities?.computed === true || (field.sourceFields?.length ?? 0) > 0
}

/**
 * The single authority on whether a field may be an import match key, and how
 * strongly it is recommended.
 *
 * Everything that answers "can this be an identifier?" goes through here,
 * `getIdentifiableFields` (the picker), `getImportableFields` (the identity toggle's
 * eligibility metadata) and `registry/field-utils`' `getIdentifierFields` /
 * `getDefaultIdentifierField` (the planner's auto-select). Those last two used
 * to be a parallel `f.isIdentifier` filter, so retiering one silently disagreed
 * with the other.
 *
 * @param field - Registry/merged field definition
 * @returns Eligibility, or `null` when the field may never be a match key
 */
export function getIdentifierEligibility(field: ResourceField): IdentifierEligibility | null {
  // Hidden fields are invisible in every other user-facing surface; never offer
  // one here either.
  // Optional-chained throughout: a partially-built field (a hand-made resource, a
  // projection that dropped capabilities) must be judged INELIGIBLE, never throw —
  // this is called from relation policy, which runs on resources it did not build.
  if (field.capabilities?.hidden) return null

  // The lookup filters on the field, so it has to be filterable. This is the one
  // pre-existing rule the tiering keeps unchanged.
  if (!field.capabilities?.filterable) return null

  // A computed field has no stored value of its own to match against.
  if (isComputed(field)) return null

  // A multi-value cell holds a LIST. "Which of these three emails identifies the
  // record" has no answer, and `TAGS` is the same question with nicer syntax.
  if (field.options?.multi === true) return null

  if (!ELIGIBLE_IDENTIFIER_TYPES.has(field.type) && !isEligibleEnumLeg(field)) return null

  // 🛑 Every natural-key leg is composite-only, whatever its type. The rule was
  // written as `type === RELATION` when both declared keys were relation pairs,
  // and the reasoning it gives - a leg "can still never be flagged as a lone
  // key" - was never about relations. `tariff_code.code` is a STRING leg, and
  // left alone it is tier 1, not composite-only, and therefore what the
  // planner AUTO-SELECTS: every origin of one classification keyed together and
  // silently merged on import.
  const compositeOnly = field.type === BaseType.RELATION || isNaturalKeyLeg(field)

  const outputKey = getFieldOutputKey(field)
  const isRecommended =
    field.capabilities?.unique === true ||
    field.isUnique === true ||
    field.isIdentifier === true ||
    // A declared natural-key leg is RECOMMENDED even though it carries no
    // uniqueness of its own — that is the entire point of declaring one. The
    // tuple is enforced by nothing and identifies the record anyway, so leaving
    // `(part, supplier)` at tier 2 behind "Not enforced unique" would bury the
    // only identity `vendor_part` has under a caveat that reads like a warning.
    // It stays `compositeOnly` (it is a RELATION), so it can still never be
    // flagged as a lone key.
    field.naturalKeyPosition !== undefined ||
    INTRINSIC_IDENTIFIER_KEYS.has(outputKey)

  return isRecommended
    ? { tier: 1, compositeOnly }
    : { tier: 2, compositeOnly, note: TIER_2_IDENTIFIER_NOTE }
}

/**
 * Picker order for eligible identifier fields: tier 1 first, then everything
 * else in declaration order.
 *
 * Record ID sorts LAST inside tier 1, and that is load-bearing. The seeder
 * excludes `id`, so `mergeSystemAndCustomFields` lands the static field in
 * `unmatchedStaticFields`, which sorts FIRST, which is why the planner's
 * auto-select has always resolved to `id` and why no row has ever classified as
 * `update` (no CSV carries cuids). A real identifier, `sku`, `email`, must
 * beat it.
 *
 * @param fields - Eligible fields, each paired with its eligibility
 * @returns The same entries, ordered for display and for auto-select
 */
export function sortByIdentifierPreference<T>(
  fields: T[],
  select: (item: T) => { key: string; tier: IdentifierTier }
): T[] {
  return fields
    .map((entry, index) => ({ entry, index, ...select(entry) }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      const aIsRecordId = a.key === 'id'
      const bIsRecordId = b.key === 'id'
      if (aIsRecordId !== bIsRecordId) return aIsRecordId ? 1 : -1
      return a.index - b.index
    })
    .map(({ entry }) => entry)
}
