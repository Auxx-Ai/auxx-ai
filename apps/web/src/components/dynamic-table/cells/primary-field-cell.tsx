// apps/web/src/components/dynamic-table/cells/primary-field-cell.tsx
'use client'

import { memo, useMemo, type ReactNode } from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useFieldValue } from '~/components/resources/store/field-value-store'
import { formatToDisplayValue } from '@auxx/lib/field-values/client'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { PrimaryCell } from './primary-cell'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { useField } from '~/components/resources/hooks/use-field'
import { toResourceId } from '~/components/resources'

/**
 * Props for PrimaryFieldCell component
 */
interface PrimaryFieldCellProps {
  /** ResourceFieldId in format "entityDefinitionId:fieldId" */
  resourceFieldId: ResourceFieldId
  /** Row ID (record's unique identifier) */
  rowId: string
  /** Click handler for the title */
  onTitleClick: () => void
  /** Dropdown menu items passed as children */
  children: ReactNode
}

/**
 * Primary field cell that subscribes directly to the Zustand store.
 * Uses useFieldValue for reactive value updates, ensuring the cell
 * re-renders when values are fetched or updated.
 *
 * This component wraps PrimaryCell with store subscription logic,
 * following the same pattern as CustomFieldCell.
 */
export const PrimaryFieldCell = memo(function PrimaryFieldCell({
  resourceFieldId,
  rowId,
  onTitleClick,
  children,
}: PrimaryFieldCellProps) {
  // Extract entityDefinitionId and fieldId from ResourceFieldId
  const { entityDefinitionId, fieldId } = useMemo(
    () => parseResourceFieldId(resourceFieldId),
    [resourceFieldId]
  )

  // Build resourceId from entityDefinitionId and rowId
  const resourceId = useMemo(
    () => toResourceId(entityDefinitionId, rowId),
    [entityDefinitionId, rowId]
  )

  // Direct store subscription - triggers re-render when value changes
  const { value, isLoading } = useFieldValue(resourceId, fieldId)

  // Get field metadata
  const field = useField(resourceFieldId)
  const fieldType = field?.fieldType

  // Format value for display
  const displayValue: string | null = useMemo(() => {
    if (value == null) return null
    if (!fieldType) return String(value)
    // Handle TypedFieldValue from store using centralized formatter
    if (typeof value === 'object' && 'type' in value) {
      const formatted = formatToDisplayValue(value as TypedFieldValue, fieldType)
      return typeof formatted === 'string' ? formatted : null
    }
    // Handle raw value (fallback)
    return String(value)
  }, [value, fieldType])

  // Show skeleton while loading and no value yet
  if (isLoading && value === undefined) {
    return (
      <div className="flex items-center pl-3 pr-2">
        <Skeleton className="h-5 w-32" />
      </div>
    )
  }

  return (
    <PrimaryCell value={displayValue} onTitleClick={onTitleClick}>
      {children}
    </PrimaryCell>
  )
})
