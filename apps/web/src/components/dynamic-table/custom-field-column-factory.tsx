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
import { Skeleton } from '@auxx/ui/components/skeleton'
import { FormattedCell, CellPadding } from './components/formatted-cell'
import type { ExtendedColumnDef } from './types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'

// ─────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────

/** Map field type to column type for filtering/sorting */
export const mapFieldTypeToColumnType = (fieldType: string): ExtendedColumnDef['columnType'] => {
  switch (fieldType) {
    case 'EMAIL':
      return 'email'
    case 'PHONE_INTL':
      return 'phone'
    case 'DATE':
    case 'DATETIME':
    case 'TIME':
      return 'date'
    case 'NUMBER':
      return 'number'
    case 'CURRENCY':
      return 'currency'
    case 'CHECKBOX':
      return 'boolean'
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
      return 'select'
    case 'TEXT':
    case 'RICH_TEXT':
    case 'ADDRESS_STRUCT':
    case 'URL':
    case 'TAGS':
    case 'FILE':
    default:
      return 'text'
  }
}

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
  /**
   * Value accessor function - reads from the syncer store.
   * Returns undefined if not yet loaded.
   */
  getValue: (rowId: string, fieldId: string) => unknown | undefined

  /**
   * Loading state accessor.
   * Returns true if the value is currently being fetched.
   */
  isValueLoading?: (rowId: string, fieldId: string) => boolean
}

// ─────────────────────────────────────────────────────────────────
// COLUMN FACTORY
// ─────────────────────────────────────────────────────────────────

/**
 * Create columns for custom fields using the value syncer.
 * Values are read from the syncer store via getValue, not from row.customFieldValues.
 *
 * @param fields - Array of ResourceField definitions
 * @param options - getValue and isValueLoading callbacks from useCustomFieldValueSyncer
 * @returns Array of ExtendedColumnDef columns
 *
 * @example
 * ```tsx
 * const { getValue, isValueLoading } = useCustomFieldValueSyncer({
 *   resourceType: 'contact',
 *   rowIds: contacts.map(c => c.id),
 *   columnVisibility,
 *   customFieldColumnIds: fields.map(f => `customField_${f.id}`),
 * })
 *
 * const columns = createCustomFieldColumns<Contact>(fields, { getValue, isValueLoading })
 * ```
 */
export function createCustomFieldColumns<T extends { id: string }>(
  fields: ResourceField[],
  options: CustomFieldColumnOptions
): ExtendedColumnDef<T>[] {
  const { getValue, isValueLoading } = options

  return fields
    .filter((f) => f.id) // Only fields with IDs (custom fields)
    .map((field) => {
      const fieldType = mapBaseTypeToFieldType(field.type)
      const columnId = `customField_${field.id}`
      const fieldId = field.id!

      // Convert enumValues to options format for select renderers
      const enumOptions = field.enumValues?.map((e) => ({ label: e.label, value: e.dbValue }))

      return {
        id: columnId,
        // accessorFn gets value from store via getValue
        accessorFn: (row: T) => getValue(row.id, fieldId),
        header: field.label,
        columnType: mapFieldTypeToColumnType(fieldType),
        fieldType,
        icon: getIconForFieldType(fieldType),
        enableSorting: field.capabilities?.sortable ?? true,
        enableFiltering: field.capabilities?.filterable ?? true,
        enableResizing: true,
        enableReorder: true,
        defaultVisible: true,
        minSize: 100,
        size: 150,
        cell: ({ row }) => {
          const value = getValue(row.original.id, fieldId)
          const loading = isValueLoading?.(row.original.id, fieldId)

          // Show skeleton while loading
          if (loading && value === undefined) {
            return (
              <CellPadding>
                <Skeleton className="h-5 w-20" />
              </CellPadding>
            )
          }

          // All types use FormattedCell - renderers handle their own padding
          return (
            <FormattedCell
              value={value}
              fieldType={fieldType}
              columnId={columnId}
              options={enumOptions}
            />
          )
        },
      } satisfies ExtendedColumnDef<T>
    })
}
