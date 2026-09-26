// packages/lib/src/resources/crud/create-defaults.ts

import type { schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { UnprocessableEntityError } from '../../errors'
import type { ResourceField } from '../registry/field-types'

type CustomFieldEntity = typeof schema.CustomField.$inferSelect

/**
 * True if a value is considered present for required-field validation.
 * Null, undefined, empty string, and empty arrays count as missing.
 */
function isValuePresent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

/**
 * Coerce a stored `defaultValue` (typically `text` in the DB, or typed primitive
 * from the static registry) into the shape the downstream field-value pipeline
 * expects. String inputs are parsed for NUMBER/CURRENCY/CHECKBOX/MULTI_SELECT;
 * everything else passes through. Returns `undefined` when a numeric string
 * can't be parsed so the default is silently skipped instead of throwing.
 */
function coerceDefault(raw: unknown, fieldType: FieldType | undefined): unknown {
  if (typeof raw !== 'string') return raw
  switch (fieldType) {
    case FieldTypeEnum.NUMBER:
    case FieldTypeEnum.CURRENCY: {
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) ? n : undefined
    }
    case FieldTypeEnum.CHECKBOX:
      return raw === 'true' || raw === '1'
    case FieldTypeEnum.MULTI_SELECT:
    case FieldTypeEnum.TAGS:
      return [raw]
    default:
      return raw
  }
}

/**
 * Fill missing keys in `values` with each field's configured `defaultValue`.
 * Only applies to `capabilities.creatable` fields (hook-owned fields like
 * `ticket_number` / `created_by_id` are skipped). Respects explicit `null` as
 * "caller is clearing" — does not overwrite. Runs before `runPreHooks` so the
 * required-field check and hooks see the defaulted values uniformly.
 *
 * Source of fields is the cached `Resource` — it merges static-registry
 * defaults (e.g. `ticket_type: 'GENERAL'`) with DB `CustomField.defaultValue`
 * for custom entity fields.
 */
export function applyDefaults(
  values: Record<string, unknown>,
  fields: ResourceField[]
): Record<string, unknown> {
  const out = { ...values }
  for (const f of fields) {
    if (!f.capabilities?.creatable) continue
    if (f.defaultValue === undefined || f.defaultValue === null) continue
    if (typeof f.defaultValue === 'string' && f.defaultValue === '') continue
    const keys = [f.systemAttribute, f.key, f.id].filter(Boolean) as string[]
    const alreadySet = keys.some((k) => k in values)
    if (alreadySet) continue
    const coerced = coerceDefault(f.defaultValue, f.fieldType)
    if (coerced === undefined) continue
    // Canonical key — matches the id list_entity_fields returns and the lookup
    // setFieldValues uses (`systemAttribute ?? name`).
    const canonical = f.systemAttribute ?? f.key
    out[canonical] = coerced
  }
  return out
}

/**
 * Validate that all creatable+required fields are present in the input map.
 * Runs BEFORE any pre-hook with DB side effects (e.g. ticket number allocation)
 * so a missing field never leaves orphaned state behind.
 *
 * Keys in `values` can be the field's `systemAttribute`, `name`, or UUID.
 * Fields with `isCreatable === false` are skipped — those are auto-populated
 * by hooks (e.g. ticket_number, created_by_id).
 */
export function assertRequiredFieldsPresent(
  fields: CustomFieldEntity[],
  values: Record<string, unknown>
): void {
  const missing = fields.filter((f) => {
    if (!f.required || !f.isCreatable) return false
    const keys = [f.systemAttribute, f.name, f.id].filter(Boolean) as string[]
    return !keys.some((k) => k in values && isValuePresent(values[k]))
  })

  if (missing.length === 0) return

  const labels = missing.map((f) => f.name)
  throw new UnprocessableEntityError(`Missing required fields: ${labels.join(', ')}`, {
    missingFields: missing.map((f) => f.systemAttribute ?? f.name),
    missingFieldLabels: labels,
  })
}
