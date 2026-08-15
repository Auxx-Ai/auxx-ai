// packages/lib/src/mail-filters/normalize-conditions.ts

import { formatPhoneNumber } from '@auxx/utils/contact'
import type { Condition, ConditionGroup } from '../conditions/types'

/**
 * The address fields whose values are `Participant.identifier` — the only ones
 * a phone number can be written into.
 */
const ADDRESS_FIELD_IDS = new Set(['from', 'to', 'sender'])

/**
 * Operators that compare a WHOLE identifier.
 *
 * Only these are normalized. `contains` / `starts with` / `ends with` compare a
 * FRAGMENT, and E.164 normalisation would destroy the fragment: "starts with
 * `+1510`" is a legitimate area-code rule, and `formatPhoneNumber('+1510')`
 * is `null` anyway (it is not a valid number). Leaving them verbatim is the
 * whole reason this is a per-operator decision rather than a blanket one.
 */
const EXACT_OPERATORS = new Set(['is', 'is not', 'in', 'not in'])

/**
 * Rewrite phone values on address conditions into E.164, at AUTHORING time.
 *
 * ## Why this exists
 *
 * Ingest stores phone identifiers in E.164 (`+15102055536`). A human typing
 * `(510) 205-5536` into a filter condition produces a value that compiles
 * cleanly, saves cleanly, previews "0 matches" and then never fires — with
 * nothing in the logs, because nothing was dropped. `assertFilterConditionsCompile`
 * and the fail-closed `AND false` both catch UNDISPATCHABLE conditions, not
 * NEVER-MATCHING ones, so neither guard sees this. It is the defect most likely
 * to reach a user as "filters are broken".
 *
 * ## Why at authoring rather than at compile
 *
 * So the saved filter reads back exactly what it will match. Normalising inside
 * the query builder would leave the editor showing `(510) 205-5536` while the
 * engine matched something else — the same class of silent divergence, just
 * moved. It also keeps the fire path, the preview count and the retroactive
 * backfill compiling the identical string, which is what makes all three agree.
 *
 * ## Why `formatPhoneNumber`
 *
 * It is THE shared E.164 normaliser — `fieldValueSchemas.phone` (the write path
 * for every `PHONE_INTL` field value) and `normalizeForLookup` (the read-side
 * lookup key) both go through it, and `field-values/__tests__/phone-e164.test.ts`
 * pins the pair in lockstep. A second parse here is how the ingest normaliser
 * (`ingest/participants/normalize.ts`, digit-strip only, never adds a country
 * code) and this one would drift.
 *
 * It returns `null` for anything that is not a valid phone number, which is
 * exactly the test for "is this value a phone number at all" — an email address
 * or a Facebook PSID falls through untouched. Its default region is `US`, so a
 * national-format number is read as a US one; an international number must be
 * written with its `+` prefix either way.
 *
 * Pure: returns a new tree and never mutates the input.
 */
export function normalizePhoneConditionValues(groups: ConditionGroup[]): ConditionGroup[] {
  return groups.map((group) => ({
    ...group,
    conditions: group.conditions.map(normalizeCondition),
  }))
}

function normalizeCondition(condition: Condition): Condition {
  if (typeof condition.fieldId !== 'string' || !ADDRESS_FIELD_IDS.has(condition.fieldId)) {
    return condition
  }
  if (!EXACT_OPERATORS.has(condition.operator)) return condition

  if (Array.isArray(condition.value)) {
    const values = condition.value.map(normalizeValue)
    return values.some((v, i) => v !== condition.value[i])
      ? { ...condition, value: values }
      : condition
  }

  const normalized = normalizeValue(condition.value)
  return normalized === condition.value ? condition : { ...condition, value: normalized }
}

/** E.164 if the value parses as a phone number; the original value otherwise. */
function normalizeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.includes('@')) return value
  return formatPhoneNumber(trimmed) ?? value
}
