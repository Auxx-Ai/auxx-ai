// apps/web/src/components/data-import/column-mapping/column-mapping-table.tsx

'use client'

import type { ImportStrategyMode } from '@auxx/lib/import/client'
import type { ColumnMappingUI, ImportableField } from '../types'
import { ColumnMappingRow } from './column-mapping-row'
import type { ColumnPolicyPatch } from './column-policy-popover'

interface ColumnMappingTableProps {
  mappings: ColumnMappingUI[]
  availableFields: ImportableField[]
  activeColumn: number | null
  /** Job-level import mode. */
  mode: ImportStrategyMode
  /** Column indexes currently in flight, their write controls are disabled. */
  savingColumns?: ReadonlySet<number>
  onSelectColumn: (columnIndex: number) => void
  onChange: (
    columnIndex: number,
    fieldKey: string | null,
    resolutionType: string,
    matchField?: string
  ) => void
  onToggleIdentifier: (columnIndex: number, next: boolean) => void
  onPolicyChange: (columnIndex: number, patch: ColumnPolicyPatch) => void
}

/**
 * Column mapping list with header.
 * Three columns: CSV Column | Arrow | Maps To
 */
export function ColumnMappingTable({
  mappings,
  availableFields,
  activeColumn,
  mode,
  savingColumns,
  onSelectColumn,
  onChange,
  onToggleIdentifier,
  onPolicyChange,
}: ColumnMappingTableProps) {
  /**
   * How many OTHER columns carry the identity flag. A composite-only (RELATION)
   * identifier is valid only when this is at least one, a lone relation match
   * key is never a record's identity.
   */
  const identifierCount = mappings.filter((m) => m.identityRole?.kind === 'match').length

  return (
    <div className='border border-l-0 border-t-0'>
      {/* Header */}
      <div className='flex items-center ps-6 px-3 py-2 bg-primary-200/50 border-b text-sm font-medium text-muted-foreground sticky sm:top-[48px] backdrop-blur-sm h-fit min-h-0 z-10'>
        <div className='flex-[0.4]'>CSV Column</div>
        <div className='flex-[0.2] text-center' />
        <div className='flex-[0.4]'>Maps To</div>
      </div>

      {/* Rows */}
      <div className='divide-y'>
        {mappings.map((mapping) => (
          <ColumnMappingRow
            key={mapping.sourceColumnIndex}
            mapping={mapping}
            availableFields={availableFields}
            isActive={activeColumn === mapping.sourceColumnIndex}
            mode={mode}
            otherIdentifierCount={
              identifierCount - (mapping.identityRole?.kind === 'match' ? 1 : 0)
            }
            isSaving={savingColumns?.has(mapping.sourceColumnIndex)}
            onClick={() => onSelectColumn(mapping.sourceColumnIndex)}
            usedFieldKeys={mappings
              .filter((m) => m.isMapped && m.sourceColumnIndex !== mapping.sourceColumnIndex)
              .map((m) => m.targetFieldKey!)}
            onChange={(fieldKey, matchField) =>
              onChange(mapping.sourceColumnIndex, fieldKey, mapping.resolutionType, matchField)
            }
            onToggleIdentifier={(next) => onToggleIdentifier(mapping.sourceColumnIndex, next)}
            onPolicyChange={(patch) => onPolicyChange(mapping.sourceColumnIndex, patch)}
          />
        ))}
      </div>
    </div>
  )
}
