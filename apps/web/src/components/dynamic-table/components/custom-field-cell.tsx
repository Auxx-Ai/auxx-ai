// apps/web/src/components/dynamic-table/components/custom-field-cell.tsx

'use client'

import { memo, useMemo } from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { FormattedCell, CellPadding } from './formatted-cell'
import { useFieldValue } from '~/components/resources/store/field-value-store'
import { useField } from '~/components/resources/hooks/use-field'
import { parseResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/lib/resources/client'

interface CustomFieldCellProps {
  /** Record ID (entityDefinitionId:rowId) */
  recordId: RecordId
  /** Column ID in ResourceFieldId format (entityDefinitionId:fieldId) */
  columnId: string
  /** @deprecated Field options - now fetched via useField hook for reactivity */
  options?: unknown
}

/**
 * Custom field cell that subscribes directly to:
 * 1. Value from Zustand store (for reactive value updates)
 * 2. Field metadata from useField hook (O(1) lookup, granular reactivity)
 *
 * This bypasses row memoization issues by subscribing directly to data sources.
 * Uses useField instead of useResource for efficient field-specific updates.
 */
export const CustomFieldCell = memo(function CustomFieldCell({
  recordId,
  columnId, // Now in ResourceFieldId format
  options: propOptions,
}: CustomFieldCellProps) {
  // Extract fieldId from ResourceFieldId format (columnId)
  const fieldId = useMemo(() => {
    const { fieldId } = parseResourceFieldId(columnId)
    return fieldId
  }, [columnId])

  // Direct store subscription - triggers re-render when value changes
  const { value, isLoading } = useFieldValue(recordId, fieldId)

  // Granular field subscription - only rerenders when THIS field changes
  // columnId is already in ResourceFieldId format
  const field = useField(columnId)
  const options = field?.options ?? propOptions
  const fieldType = field?.fieldType

  if (isLoading && value === undefined) {
    return (
      <CellPadding>
        <Skeleton className="h-5 w-20" />
      </CellPadding>
    )
  }

  return <FormattedCell value={value} fieldType={fieldType} columnId={columnId} options={options} />
})
