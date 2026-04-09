// packages/lib/src/resources/events/extract-event-data.ts

import type { FieldType } from '@auxx/database/types'
import type { TypedFieldValue } from '@auxx/types/field-value'
import type { RecordId } from '@auxx/types/resource'
import type { FieldValueService } from '../../field-values/field-value-service'
import { formatToRawValue } from '../../field-values/formatter'

/**
 * Extract eventData from field values using systemAttribute names.
 * Returns data ready for timeline display - no transformation needed downstream.
 *
 * @param entityType - The entity type (e.g., 'ticket', 'contact')
 * @param fields - Custom fields for the entity
 * @param values - Field values keyed by fieldId
 * @returns eventData object with systemAttribute keys
 *
 * @example
 * // For a ticket with values:
 * // { fieldId1: 'Contact123', fieldId2: 'TKT-001', fieldId3: 'Issue title' }
 * // Where fields have systemAttributes: ticket_contact, ticket_number, ticket_title
 * // Returns:
 * // { ticket_contact: 'Contact123', ticket_number: 'TKT-001', ticket_title: 'Issue title' }
 */
export function extractEventData(
  entityType: string | null,
  fields: Array<{ id: string; systemAttribute: string | null }>,
  values: Record<string, unknown>
): Record<string, unknown> {
  const eventData: Record<string, unknown> = {}

  // Add all field values keyed by their systemAttribute
  for (const field of fields) {
    if (field.systemAttribute && field.id in values) {
      eventData[field.systemAttribute] = values[field.id]
    }
  }

  return eventData
}

/**
 * Find the relatedRecordId for an entity based on its relationships.
 * For tickets, this is the contact.
 *
 * @param entityType - The entity type (e.g., 'ticket', 'contact')
 * @param eventData - Extracted event data with systemAttribute values
 * @returns RecordId of the related entity, or undefined
 */
export function findRelatedRecordId(
  entityType: string | null,
  eventData: Record<string, unknown>
): RecordId | undefined {
  // For tickets, the related entity is the contact
  if (entityType === 'ticket') {
    const contactValue = eventData.ticket_contact
    if (contactValue && typeof contactValue === 'string') {
      // ticket_contact stores the RecordId directly (from RECORD_LINK field)
      return contactValue.includes(':') ? (contactValue as RecordId) : undefined
    }
  }

  return undefined
}

/**
 * Capture field values from an existing entity for use as event data.
 * Used before deletion so the event carries the entity's field values
 * (matching the format produced by extractEventData for create/update events).
 *
 * @param fieldValueService - FieldValueService instance
 * @param recordId - The entity's RecordId
 * @param fields - Custom fields for the entity (with id, systemAttribute, type)
 * @returns eventData object with systemAttribute keys and raw values
 */
export async function captureEventData(
  fieldValueService: FieldValueService,
  recordId: RecordId,
  fields: Array<{ id: string; systemAttribute: string | null; type: string }>
): Promise<Record<string, unknown>> {
  const valuesMap = await fieldValueService.getValues({ recordId })

  // Convert TypedFieldValues → raw values keyed by fieldId (matching extractEventData input)
  const rawValues: Record<string, unknown> = {}
  for (const field of fields) {
    if (!field.systemAttribute) continue
    const typedValue = valuesMap.get(field.id)
    if (typedValue === undefined) continue
    rawValues[field.id] = formatToRawValue(
      typedValue as TypedFieldValue | TypedFieldValue[],
      field.type as FieldType
    )
  }

  return extractEventData(null, fields, rawValues)
}
