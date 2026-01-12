// apps/web/src/components/dynamic-table/custom-field-column-factory.tsx

'use client'

import {
  Calendar,
  CalendarClock,
  Clock,
  Mail,
  Phone,
  Link2,
  Hash,
  CheckSquare,
  Type,
  MapPin,
  FileText,
  List,
  Paperclip,
  Tag,
  Link,
  DollarSign,
} from 'lucide-react'
import { CustomFieldCell } from './components/custom-field-cell'
import type { ExtendedColumnDef } from './types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'

// ─────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────

/** Get icon for field type */
export const getIconForFieldType = (fieldType: string) => {
  switch (fieldType) {
    case 'EMAIL':
      return Mail
    case 'PHONE_INTL':
      return Phone
    case 'URL':
      return Link2
    case 'DATE':
      return Calendar
    case 'DATETIME':
      return CalendarClock
    case 'TIME':
      return Clock
    case 'NUMBER':
      return Hash
    case 'CURRENCY':
      return DollarSign
    case 'CHECKBOX':
      return CheckSquare
    case 'TEXT':
      return Type
    case 'RICH_TEXT':
      return FileText
    case 'ADDRESS_STRUCT':
      return MapPin
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
      return List
    case 'FILE':
      return Paperclip
    case 'TAGS':
      return Tag
    case 'RELATIONSHIP':
      return Link
    default:
      return Type
  }
}

// ─────────────────────────────────────────────────────────────────
// COLUMN FACTORY OPTIONS
// ─────────────────────────────────────────────────────────────────

/** Options for creating custom field columns */
export interface CustomFieldColumnOptions {
  /** Entity definition ID (e.g., 'contact', 'ticket', or custom entity UUID) */
  entityDefinitionId: string
}

// ─────────────────────────────────────────────────────────────────
// COLUMN FACTORY
// ─────────────────────────────────────────────────────────────────

/**
 * Create columns for custom fields using cell-level store subscriptions.
 * Each cell subscribes directly to the Zustand store for its specific value,
 * ensuring automatic re-renders when values change.
 *
 * @param fields - Array of ResourceField definitions
 * @param options - entityDefinitionId for store subscription
 * @returns Array of ExtendedColumnDef columns
 *
 * @example
 * ```tsx
 * // Syncer still triggers batch fetches for visible columns
 * useCustomFieldValueSyncer({
 *   entityDefinitionId: 'contact',
 *   rowIds: contacts.map(c => c.id),
 *   columnVisibility,
 *   customFieldColumnIds: fields.map(f => `customField_${f.id}`),
 * })
 *
 * // Cells subscribe directly to store - no getValue/isValueLoading needed
 * const columns = createCustomFieldColumns<Contact>(fields, { entityDefinitionId: 'contact' })
 * ```
 */
export function createCustomFieldColumns<T extends { id: string }>(
  fields: ResourceField[],
  options: CustomFieldColumnOptions
): ExtendedColumnDef<T>[] {
  const { entityDefinitionId } = options

  return fields
    .filter((f) => f.id) // Only fields with IDs (custom fields)
    .map((field) => {
      const fieldType = mapBaseTypeToFieldType(field.type)
      const columnId = `customField_${field.id}`
      const fieldId = field.id!

      // Build options object for cell renderer
      // For SELECT fields: convert enumValues to options array format
      // For other fields: pass field.options directly (contains display options)
      const cellOptions = field.enumValues
        ? { options: field.enumValues.map((e) => ({ label: e.label, value: e.dbValue })) }
        : field.options

      return {
        id: columnId,
        // accessorFn not used for display - cells read from store directly
        accessorFn: () => undefined,
        header: field.label,
        fieldType,
        icon: getIconForFieldType(fieldType),
        enableSorting: field.capabilities?.sortable ?? true,
        enableFiltering: field.capabilities?.filterable ?? true,
        enableResizing: true,
        enableReorder: true,
        defaultVisible: true,
        minSize: 100,
        size: 150,
        cell: ({ row }) => (
          <CustomFieldCell
            entityDefinitionId={entityDefinitionId}
            rowId={row.original.id}
            fieldId={fieldId}
            fieldType={fieldType}
            columnId={columnId}
            options={cellOptions}
          />
        ),
      } satisfies ExtendedColumnDef<T>
    })
}
