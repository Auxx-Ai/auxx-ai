// apps/web/src/components/dynamic-table/components/custom-field-cell.tsx

'use client'

import { memo, useMemo } from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { FormattedCell, CellPadding } from './formatted-cell'
import {
  useFieldValue,
  toResourceId,
} from '~/components/resources/store/custom-field-value-store'
import { useField } from '~/components/resources/hooks/use-field'
import { toResourceFieldId, toFieldId } from '@auxx/types/field'

interface CustomFieldCellProps {
  /** Entity definition ID (e.g., 'contact', 'ticket', or custom entity UUID) */
  entityDefinitionId: string
  /** Row ID to look up value */
  rowId: string
  /** Field ID to look up value */
  fieldId: string
  /** Field type for rendering */
  fieldType: string
  /** Column ID for formatting lookup */
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
  entityDefinitionId,
  rowId,
  fieldId,
  fieldType,
  columnId,
  options: propOptions,
}: CustomFieldCellProps) {
  // Build resourceId for store lookups
  const resourceId = toResourceId(entityDefinitionId, rowId)

  // Direct store subscription - triggers re-render when value changes
  const { value, isLoading } = useFieldValue(resourceId, fieldId)

  // Granular field subscription - only rerenders when THIS field changes
  const resourceFieldId = useMemo(
    () => toResourceFieldId(entityDefinitionId, toFieldId(fieldId)),
    [entityDefinitionId, fieldId]
  )
  const field = useField(resourceFieldId)
  const options = field?.options ?? propOptions

  if (isLoading && value === undefined) {
    return (
      <CellPadding>
        <Skeleton className="h-5 w-20" />
      </CellPadding>
    )
  }

  return <FormattedCell value={value} fieldType={fieldType} columnId={columnId} options={options} />
})
