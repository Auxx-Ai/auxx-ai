// packages/lib/src/ai/kopilot/capabilities/entities/format-enriched-fields.ts

import type { FieldType } from '@auxx/database/types'
import type { EnrichedField } from './enrich-entity-fields'

/** Maps FieldType → cell type hint for the auxx:table block */
const FIELD_TYPE_TO_CELL_TYPE: Partial<Record<FieldType, string>> = {
  ACTOR: 'actor',
  DATE: 'date',
  DATETIME: 'date',
  TAGS: 'tags',
  SINGLE_SELECT: 'tags',
  MULTI_SELECT: 'tags',
  EMAIL: 'email',
  PHONE_INTL: 'phone',
  CURRENCY: 'currency',
  NUMBER: 'number',
}

export interface FormattedField {
  text: string
  type?: string
  actorId?: string
  tags?: Array<{ label: string; color?: string }>
  recordId?: string
  recordIds?: string[]
}

/**
 * Convert enriched field metadata into a shape the LLM can pass through to auxx:table cells.
 *
 * Uses rawValue from existing converters:
 * - ACTOR rawValue = { actorType, id, actorId } → extract actorId
 * - SELECT/TAGS rawValue = optionId string → look up label + color in field.options
 * - DATE rawValue = ISO string → already in text
 * - Others → text only
 */
export function formatEnrichedFields(
  fields: Record<string, EnrichedField>
): Record<string, FormattedField> {
  const result: Record<string, FormattedField> = {}

  for (const [label, field] of Object.entries(fields)) {
    const cellType = FIELD_TYPE_TO_CELL_TYPE[field.fieldType]

    // Display value → text fallback (flatten arrays to comma-separated)
    const text = Array.isArray(field.displayValue)
      ? field.displayValue.map(String).join(', ')
      : String(field.displayValue ?? '—')

    const formatted: FormattedField = { text }

    if (cellType) {
      formatted.type = cellType
    }

    // ACTOR: extract actorId from converter's rawValue
    if (field.fieldType === 'ACTOR' && field.rawValue) {
      const rawValues = Array.isArray(field.rawValue) ? field.rawValue : [field.rawValue]
      const firstActor = rawValues[0] as { actorId?: string } | undefined
      if (firstActor?.actorId) {
        formatted.actorId = firstActor.actorId
      }
    }

    // SELECT/TAGS: look up option labels + colors from field.options
    if (
      (field.fieldType === 'SINGLE_SELECT' ||
        field.fieldType === 'MULTI_SELECT' ||
        field.fieldType === 'TAGS') &&
      field.rawValue
    ) {
      const optionIds = Array.isArray(field.rawValue)
        ? (field.rawValue as string[])
        : [field.rawValue as string]

      const options = (field.options?.options ?? []) as Array<{
        id?: string
        value: string
        label: string
        color?: string
      }>
      const optionsLookup = new Map(options.map((o) => [o.id ?? o.value, o]))

      formatted.tags = optionIds
        .filter((id): id is string => typeof id === 'string' && id !== '')
        .map((optionId) => {
          const opt = optionsLookup.get(optionId)
          return {
            label: opt?.label ?? optionId,
            color: opt?.color,
          }
        })
    }

    // RELATIONSHIP: include recordIds so the LLM can create proper RecordBadge cells
    if (field.fieldType === 'RELATIONSHIP' && field.rawValue) {
      const rawValues = Array.isArray(field.rawValue) ? field.rawValue : [field.rawValue]
      const ids = rawValues.filter((v): v is string => typeof v === 'string' && v !== '')
      if (ids.length === 1) {
        formatted.recordId = ids[0]
      } else if (ids.length > 1) {
        formatted.recordIds = ids
      }
    }

    result[label] = formatted
  }

  return result
}
