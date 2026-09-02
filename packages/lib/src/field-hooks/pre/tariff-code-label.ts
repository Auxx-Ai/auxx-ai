// packages/lib/src/field-hooks/pre/tariff-code-label.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { composeTariffCodeLabel } from '../../bom/vendor-cost'
import { getOrgCache } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import { unwrapStatusValue } from '../../resources/events/captured-values'
import type { EntityFieldChangeHandler, EntityPreCreateHandler } from '../types'

const logger = createScopedLogger('field-hooks:tariff-code-label')

const CODE_ATTR = 'tariff_code_code'
const COUNTRY_ATTR = 'tariff_code_country'
const LABEL_ATTR = 'tariff_code_label'

/**
 * Stamp `tariff_code_label` onto a create (task 30 §8).
 *
 * A PRE-CREATE hook because `event.values` is the very object `createEntity`
 * hands to `setFieldValues` next, so adding a key here is how a derived field
 * lands in the same write as its inputs - no second round trip and no window in
 * which the record exists nameless. Registered AFTER `guardTariffCodeUniqueness`
 * so a refused duplicate is never stamped.
 *
 * ⚠️ Overwrites whatever a caller put under `tariff_code_label`. The field is
 * `creatable: false`, but the write path does not read capabilities (see the
 * tags guards), so a script that sends its own label would otherwise fork the
 * one string two importers match on.
 */
export const stampTariffCodeLabel: EntityPreCreateHandler = async (event) => {
  const code = readText(event.values[CODE_ATTR])
  const country = readText(event.values[COUNTRY_ATTR])
  if (!code) return
  event.values[LABEL_ATTR] = composeTariffCodeLabel(code, country)
}

/**
 * Re-stamp the label when either leg changes on an existing code.
 *
 * A FIELD-CHANGE hook rather than a field pre-hook: a pre-hook can only
 * transform the value being written, and the label is a different field. Reads
 * the other leg off the row, writes the label through the ordinary field-value
 * door so the display name, the realtime frame and the timeline all follow.
 *
 * Never fails the edit that triggered it. A stale label is a display and import
 * defect; a refused code edit is a person's work lost.
 */
export const restampTariffCodeLabel: EntityFieldChangeHandler = async (event) => {
  const attribute = event.field.systemAttribute
  if (attribute !== CODE_ATTR && attribute !== COUNTRY_ATTR) return
  // A create is stamped by `stampTariffCodeLabel` in the same write; a
  // second write from here would only re-assert it.
  if (event.isCreate) return

  const { organizationId, userId, recordId } = event
  try {
    const fields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([CODE_ATTR, COUNTRY_ATTR, LABEL_ATTR] as const)
    const codeField = fields.tariff_code_code
    const countryField = fields.tariff_code_country
    const labelField = fields.tariff_code_label
    if (!codeField || !countryField || !labelField) return

    // The changed leg from the event, the other from the row.
    const { entityInstanceId } = parseRecordId(recordId)
    const otherFieldId = attribute === CODE_ATTR ? countryField.id : codeField.id
    const [other] = await database
      .select({ valueText: schema.FieldValue.valueText, optionId: schema.FieldValue.optionId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.entityId, entityInstanceId),
          inArray(schema.FieldValue.fieldId, [otherFieldId])
        )
      )
      .limit(1)

    const changed = readText(event.newValue)
    const code = attribute === CODE_ATTR ? changed : (other?.valueText ?? null)
    const country = attribute === COUNTRY_ATTR ? changed : (other?.optionId ?? null)
    if (!code) return

    const ctx = await createFieldValueContext(organizationId, userId)
    await setValueWithType(ctx, {
      recordId,
      fieldId: labelField.id,
      fieldType: toFieldType(labelField.type),
      value: { type: 'text', value: composeTariffCodeLabel(code, country) },
    })
  } catch (error) {
    logger.warn('could not re-stamp tariff_code_label', {
      organizationId,
      recordId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * One leg as trimmed text, or `null`. Values arrive pre-coercion on the create
 * door (a bare string, or a `{value}` / `{optionId}` envelope, or a one-element
 * array from a SINGLE_SELECT) and post-write on the change door (a string, or an
 * option-id array). `unwrapStatusValue` flattens every one of those.
 */
function readText(raw: unknown): string | null {
  const value = unwrapStatusValue(raw)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
