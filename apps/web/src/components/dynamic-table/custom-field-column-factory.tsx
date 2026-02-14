// apps/web/src/components/dynamic-table/custom-field-column-factory.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import type { FieldPath } from '@auxx/types/field'
import {
  Calendar,
  CalendarClock,
  CheckSquare,
  Clock,
  DollarSign,
  FileText,
  Hash,
  Link,
  Link2,
  List,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Tag,
  Type,
} from 'lucide-react'
import { toRecordId } from '~/components/resources'
import { CustomFieldCell } from './components/custom-field-cell'
import type { ExtendedColumnDef } from './types'
import { encodeDirectFieldColumnId, encodeFieldPathColumnId } from './utils/column-id'

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
 * Create columns for custom fields and field paths using cell-level store subscriptions.
 * Handles both direct fields (ResourceFieldId) and relationship traversal paths (FieldPath).
 *
 * @param fields - Array of ResourceField or field path definitions
 * @param options - entityDefinitionId for store subscription
 * @returns Array of ExtendedColumnDef columns
 *
 * @example
 * ```tsx
 * // Direct fields
 * const columns = createCustomFieldColumns<Contact>(
 *   customFields,
 *   { entityDefinitionId: 'contact' }
 * )
 *
 * // With field paths
 * const columns = createCustomFieldColumns<Product>([
 *   ...customFields,
 *   { fieldPath: ['product:vendor', 'vendor:name'] }
 * ], { entityDefinitionId: 'product' })
 * ```
 */
export function createCustomFieldColumns<T extends { id: string }>(
  fields: Array<ResourceField | { fieldPath: FieldPath }>,
  options: CustomFieldColumnOptions
): ExtendedColumnDef<T>[] {
  const { entityDefinitionId } = options

  return fields
    .map((item) => {
      let columnId: string
      let fieldType: string | undefined
      let label: string
      let isPath = false
      let cellOptions: unknown
      let canSort = true
      let canFilter = true
      let isCustomField = true
      let fieldId: string | undefined

      // Check if this is a field path or a direct field
      if ('fieldPath' in item) {
        // Field path - encode with :: separator
        const fieldPath = item.fieldPath
        columnId = encodeFieldPathColumnId(fieldPath)
        isPath = true
        // Label will be rendered as breadcrumb in HeaderCellWrapper
        label = ''
        fieldType = undefined
        canSort = false // Disable sorting for paths (no backend support)
        canFilter = false // Disable filtering for paths (no backend support)
        isCustomField = false
      } else {
        // Direct field - use ResourceFieldId as columnId
        const field = item
        if (!field.id || !field.resourceFieldId) {
          // Skip fields without IDs
          return null as unknown as ExtendedColumnDef<T>
        }

        columnId = encodeDirectFieldColumnId(field.resourceFieldId)
        fieldType = mapBaseTypeToFieldType(field.type)
        label = field.label

        // Pass field.options directly (contains options array and display options)
        cellOptions = field.options

        canSort = field.capabilities?.sortable ?? true
        canFilter = field.capabilities?.filterable ?? true
        fieldId = field.id
      }

      return {
        id: columnId,
        // accessorFn not used for display - cells read from store directly
        accessorFn: () => undefined,
        header: label,
        fieldType,
        icon: fieldType ? getIconForFieldType(fieldType) : undefined,
        enableSorting: canSort,
        enableFiltering: canFilter,
        enableResizing: true,
        enableReorder: true,
        defaultVisible: false,
        minSize: 100,
        size: 150,
        meta: {
          isCustomField,
          fieldId,
        },
        cell: ({ row }) => (
          <CustomFieldCell
            recordId={toRecordId(entityDefinitionId, row.original.id)}
            columnId={columnId}
            options={cellOptions}
          />
        ),
      } satisfies ExtendedColumnDef<T>
    })
    .filter((col): col is ExtendedColumnDef<T> => col !== null)
}
