// apps/web/src/components/dynamic-table/components/custom-field-cell.tsx

'use client'

import { memo, useMemo } from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { FormattedCell, CellPadding } from './formatted-cell'
import {
  useCustomFieldValue,
  useCustomFieldValueLoading,
  toResourceId,
} from '~/components/resources/store/custom-field-value-store'
import { useResource } from '~/components/resources'

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
  /** @deprecated Field options - now fetched via useResource for reactivity */
  options?: unknown
}

/**
 * Custom field cell that subscribes directly to:
 * 1. Value from Zustand store (for reactive value updates)
 * 2. Field options from ResourceProvider via useResource (for reactive option updates)
 *
 * This bypasses row memoization issues by subscribing directly to data sources.
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
  const value = useCustomFieldValue(resourceId, fieldId)
  const isLoading = useCustomFieldValueLoading(resourceId, fieldId)

  // Direct resource subscription - triggers re-render when field options change
  const { resource } = useResource(entityDefinitionId)

  // Get field options from resource (reactive) with prop fallback
  const options = useMemo(() => {
    const field = resource?.fields.find((f) => f.id === fieldId)
    return field?.options ?? propOptions
  }, [resource?.fields, fieldId, propOptions])

  if (isLoading && value === undefined) {
    return (
      <CellPadding>
        <Skeleton className="h-5 w-20" />
      </CellPadding>
    )
  }

  return <FormattedCell value={value} fieldType={fieldType} columnId={columnId} options={options} />
})
