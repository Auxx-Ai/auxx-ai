// apps/web/src/components/dynamic-table/components/custom-field-cell.tsx

'use client'

import { memo } from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { FormattedCell, CellPadding } from './formatted-cell'
import {
  useCustomFieldValue,
  useCustomFieldValueLoading,
  type ResourceType,
} from '~/stores/custom-field-value-store'

interface CustomFieldCellProps {
  /** Resource type for store subscription */
  resourceType: ResourceType
  /** Entity definition ID (required for 'entity' resourceType) */
  entityDefId?: string
  /** Row ID to look up value */
  rowId: string
  /** Field ID to look up value */
  fieldId: string
  /** Field type for rendering */
  fieldType: string
  /** Column ID for formatting lookup */
  columnId: string
  /** Select/multi-select options */
  options?: Array<{ label: string; value: string }>
}

/**
 * Custom field cell that subscribes directly to the Zustand store.
 * Re-renders automatically when its specific value changes.
 * Bypasses memoization issues in the table row/cell chain.
 */
export const CustomFieldCell = memo(function CustomFieldCell({
  resourceType,
  entityDefId,
  rowId,
  fieldId,
  fieldType,
  columnId,
  options,
}: CustomFieldCellProps) {
  // Direct store subscription - triggers re-render when value changes
  const value = useCustomFieldValue(resourceType, rowId, fieldId, entityDefId)
  const isLoading = useCustomFieldValueLoading(resourceType, rowId, fieldId, entityDefId)

  if (isLoading && value === undefined) {
    return (
      <CellPadding>
        <Skeleton className="h-5 w-20" />
      </CellPadding>
    )
  }

  return <FormattedCell value={value} fieldType={fieldType} columnId={columnId} options={options} />
})
