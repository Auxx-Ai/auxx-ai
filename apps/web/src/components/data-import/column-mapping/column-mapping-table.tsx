// apps/web/src/components/data-import/column-mapping/column-mapping-table.tsx

'use client'

import { ColumnMappingRow } from './column-mapping-row'
import type { ColumnMappingUI, ImportableField } from '../types'

interface ColumnMappingTableProps {
  mappings: ColumnMappingUI[]
  availableFields: ImportableField[]
  activeColumn: number | null
  onSelectColumn: (columnIndex: number) => void
  onChange: (columnIndex: number, fieldKey: string | null, resolutionType: string, matchField?: string) => void
}

/**
 * Column mapping list with header.
 * Three columns: CSV Column | Arrow | Maps To
 */
export function ColumnMappingTable({
  mappings,
  availableFields,
  activeColumn,
  onSelectColumn,
  onChange,
}: ColumnMappingTableProps) {
  return (
    <div className="border border-l-0 border-t-0">
      {/* Header */}
      <div className="flex items-center ps-6 px-3 py-2 bg-primary-200/50 border-b text-sm font-medium text-muted-foreground sticky top-[48px] backdrop-blur-sm h-fit min-h-0 z-10">
        <div className="flex-[0.4]">CSV Column</div>
        <div className="flex-[0.2] text-center" />
        <div className="flex-[0.4]">Maps To</div>
      </div>

      {/* Rows */}
      <div className="divide-y">
        {mappings.map((mapping) => (
          <ColumnMappingRow
            key={mapping.sourceColumnIndex}
            mapping={mapping}
            availableFields={availableFields}
            isActive={activeColumn === mapping.sourceColumnIndex}
            onClick={() => onSelectColumn(mapping.sourceColumnIndex)}
            usedFieldKeys={mappings
              .filter((m) => m.isMapped && m.sourceColumnIndex !== mapping.sourceColumnIndex)
              .map((m) => m.targetFieldKey!)}
            onChange={(fieldKey, matchField) =>
              onChange(mapping.sourceColumnIndex, fieldKey, mapping.resolutionType, matchField)
            }
          />
        ))}
      </div>
    </div>
  )
}
