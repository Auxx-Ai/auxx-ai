// apps/web/src/components/data-import/plan-preview/use-plan-preview-columns.tsx

'use client'

import { useMemo } from 'react'
import { Hash } from 'lucide-react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell } from '~/components/dynamic-table'
import { StrategyCell } from './strategy-cell'
import type { PlanPreviewRow, PreviewColumnMapping } from './types'

interface UsePlanPreviewColumnsOptions {
  /** Mapped columns from import job */
  mappings: PreviewColumnMapping[]
  /** Max number of field columns to show (default: 5) */
  maxFieldColumns?: number
}

/**
 * Generate column definitions for the plan preview table.
 * Creates columns for: Row #, Strategy, and mapped fields.
 */
export function usePlanPreviewColumns(options: UsePlanPreviewColumnsOptions) {
  const { mappings, maxFieldColumns = 5 } = options

  return useMemo(() => {
    const columns: ExtendedColumnDef<PlanPreviewRow>[] = []

    // 1. Row number column (pinned left)
    columns.push({
      id: '_rowNumber',
      accessorFn: (row) => row.rowIndex + 1,
      header: '#',
      columnType: 'number',
      icon: Hash,
      enableSorting: false,
      enableFiltering: false,
      enableResize: false,
      defaultPinned: true,
      size: 60,
      minSize: 60,
      maxSize: 60,
      cell: ({ getValue }) => (
        <div className="px-3 text-muted-foreground text-sm tabular-nums">{getValue() as number}</div>
      ),
    })

    // 2. Strategy column (pinned left)
    columns.push({
      id: '_strategy',
      accessorKey: 'strategy',
      header: 'Action',
      columnType: 'text',
      enableSorting: true,
      enableFiltering: true,
      enableResize: true,
      defaultPinned: true,
      size: 140,
      minSize: 100,
      cell: ({ row }) => <StrategyCell strategy={row.original.strategy} errors={row.original.errors} />,
    })

    // 3. Field columns from mappings (limit to maxFieldColumns)
    const mappedFields = mappings.filter((m) => m.targetFieldKey && m.targetType !== 'skip').slice(0, maxFieldColumns)

    for (const mapping of mappedFields) {
      const fieldKey = mapping.targetFieldKey!

      columns.push({
        id: `field_${fieldKey}`,
        accessorFn: (row) => row.fields[fieldKey],
        header: mapping.targetFieldLabel ?? mapping.sourceColumnName ?? fieldKey,
        columnType: mapFieldTypeToColumnType(mapping.fieldType),
        enableSorting: true,
        enableFiltering: false,
        enableResize: true,
        size: 150,
        minSize: 80,
        cell: ({ getValue }) => {
          const value = getValue()
          if (value === null || value === undefined) {
            return <div className="px-3 text-muted-foreground text-sm">—</div>
          }
          return <FormattedCell value={value} fieldType={mapping.fieldType?.toUpperCase() ?? 'TEXT'} columnId={`field_${fieldKey}`} />
        },
      })
    }

    return columns
  }, [mappings, maxFieldColumns])
}

/**
 * Map import field type to DynamicTable column type
 */
function mapFieldTypeToColumnType(fieldType?: string): ExtendedColumnDef['columnType'] {
  switch (fieldType?.toLowerCase()) {
    case 'email':
      return 'email'
    case 'phone':
      return 'phone'
    case 'number':
    case 'currency':
      return 'number'
    case 'date':
    case 'datetime':
      return 'date'
    case 'boolean':
      return 'boolean'
    default:
      return 'text'
  }
}
