// packages/lib/src/field-hooks/pre/tariff-code-uniqueness-guard.ts

import { database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getOrgCache } from '../../cache'
import { ConflictError } from '../../errors'
import { unwrapStatusValue } from '../../resources/events/captured-values'
import type { EntityPreCreateHandler } from '../types'

/** The two legs of `tariff_code`'s identity. */
const CODE_ATTR = 'tariff_code_code'
const COUNTRY_ATTR = 'tariff_code_country'

/**
 * `naturalKeyPosition` DOES NOT ENFORCE ANYTHING. This does.
 *
 * 🛑 The declaration on `tariff_code_code` / `tariff_code_country` is an
 * IMPORTER concept and nothing else: the only non-test consumer of
 * `naturalKeyPosition` in the repo is `import/mapping/natural-key.ts`, which
 * uses it to decide whether an imported row updates or inserts. Nothing
 * consulted it on create, so two records for `8481.80.9005 CN` were creatable
 * through the settings page and through `record.create` alike - and a supplier
 * offer pointing at one of them resolved a different schedule from an offer
 * pointing at the other.
 *
 * 🛑 **It is a PRE-CREATE hook and not a field pre-hook, and that is not a
 * style choice.** The first version was a field pre-hook on both legs. It
 * detected the duplicate correctly and threw, and the record was created
 * anyway: `setValuesForEntity` wraps each field write in its own try/catch,
 * logs `Failed to set field <id>` and continues. The observed result was a
 * `tariff_code` with a country and NO CODE - strictly worse than the duplicate
 * it was meant to prevent. `createEntity` fires this hook before
 * `createEntityInstance`, so a rejection leaves nothing behind.
 *
 * ⚠️ **Create only.** An UPDATE that edits `code` or `country` into a collision
 * is still possible. That path needs a field pre-hook, which does work there
 * because a single-field write propagates its throw to the caller. Not built:
 * every duplicate actually observed came from a create.
 *
 * ⚠️ `vendor_part` `(part, supplier)` and `subpart` `(parentPart, childPart)`
 * have the identical hole, and `purchasing/vendor-part-lookup.ts` asserts the
 * opposite in prose - *"carries an enforced natural key ... so this resolves to
 * at most one live row"*. A generic guard driven by `getNaturalKeyFields` would
 * fix all three, but it would start refusing writes that are legal today, so it
 * needs a duplicate census first and is its own change.
 *
 * ## Storage shapes, which differ per leg
 *
 * `code` is TEXT and lands in `FieldValue.valueText`; `country` is
 * `SINGLE_SELECT` and lands in `FieldValue.optionId` - a dedicated column, not
 * the text one. Comparing the wrong column matches nothing, and the guard then
 * passes everything, silently.
 */
export const guardTariffCodeUniqueness: EntityPreCreateHandler = async (event) => {
  const code = readIncoming(event.values, CODE_ATTR)
  const country = readIncoming(event.values, COUNTRY_ATTR)
  // A create missing either leg is refused by `assertRequiredFieldsPresent`
  // before this runs, so there is no pair to judge.
  if (!code || !country) return

  const fields = await getOrgCache()
    .from(event.organizationId, 'customFields')
    .bySystemAttributes([CODE_ATTR, COUNTRY_ATTR] as const)

  const codeField = fields.tariff_code_code
  const countryField = fields.tariff_code_country
  if (!codeField || !countryField) return

  const clash = await hasDuplicate({
    organizationId: event.organizationId,
    entityDefinitionId: event.entityDefinitionId,
    codeFieldId: codeField.id,
    countryFieldId: countryField.id,
    code,
    country,
  })

  if (clash) {
    throw new ConflictError(
      `${code} ${country} is already registered. A tariff code is one record per ` +
        'classification and origin, so add the rate to the existing code rather than a second copy.'
    )
  }
}

/**
 * One leg out of the caller's patch.
 *
 * ⚠️ The patch is keyed by systemAttribute on every door that reaches here
 * today, and its values are PRE-COERCION - a bare `'CN'` from a script, or a
 * `{value}` / `{optionId}` envelope from a surface that pre-wraps.
 * {@link unwrapStatusValue} flattens all three.
 */
function readIncoming(values: Record<string, unknown>, attribute: string): string | null {
  const raw = unwrapStatusValue(values[attribute])
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
}

/**
 * Any live record in this org already holding this `(code, country)`.
 *
 * Archived rows are excluded deliberately: a soft-deleted code must not block
 * re-registering the classification it described, and `Remove code` on the
 * Tariffs page is a soft delete.
 */
async function hasDuplicate(params: {
  organizationId: string
  entityDefinitionId: string
  codeFieldId: string
  countryFieldId: string
  code: string
  country: string
}): Promise<boolean> {
  const codeValue = alias(schema.FieldValue, 'tariff_code_code_value')
  const countryValue = alias(schema.FieldValue, 'tariff_code_country_value')

  const [row] = await database
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      codeValue,
      and(
        eq(codeValue.entityId, schema.EntityInstance.id),
        eq(codeValue.organizationId, params.organizationId),
        eq(codeValue.fieldId, params.codeFieldId),
        eq(codeValue.valueText, params.code)
      )
    )
    .innerJoin(
      countryValue,
      and(
        eq(countryValue.entityId, schema.EntityInstance.id),
        eq(countryValue.organizationId, params.organizationId),
        eq(countryValue.fieldId, params.countryFieldId),
        eq(countryValue.optionId, params.country)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, params.organizationId),
        eq(schema.EntityInstance.entityDefinitionId, params.entityDefinitionId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)

  return !!row
}
