// apps/web/src/components/dynamic-table/cells/primary-field-cell.tsx
'use client'

import { memo, useMemo, type ReactNode } from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  useCustomFieldValue,
  useCustomFieldValueLoading,
  type ResourceType,
} from '~/components/resources/store/custom-field-value-store'
import { formatToDisplayValue } from '@auxx/lib/field-values/client'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { PrimaryCell } from './primary-cell'

/**
 * Props for PrimaryFieldCell component
 */
interface PrimaryFieldCellProps {
  /** Resource type for store subscription */
  resourceType: ResourceType
  /** Entity definition ID (required for 'entity' resourceType) */
  entityDefId?: string
  /** Row ID to look up value */
  rowId: string
  /** Field ID to look up value */
  fieldId: string
  /** Field type for formatting */
  fieldType: string
  /** Click handler for the title */
  onTitleClick: () => void
  /** Dropdown menu items passed as children */
  children: ReactNode
}

/**
 * Primary field cell that subscribes directly to the Zustand store.
 * Uses useCustomFieldValue for reactive value updates, ensuring the cell
 * re-renders when values are fetched or updated.
 *
 * This component wraps PrimaryCell with store subscription logic,
 * following the same pattern as CustomFieldCell.
 */
export const PrimaryFieldCell = memo(function PrimaryFieldCell({
  resourceType,
  entityDefId,
  rowId,
  fieldId,
  fieldType,
  onTitleClick,
  children,
}: PrimaryFieldCellProps) {
  // Direct store subscription - triggers re-render when value changes
  const value = useCustomFieldValue(resourceType, rowId, fieldId, entityDefId)
  const isLoading = useCustomFieldValueLoading(resourceType, rowId, fieldId, entityDefId)

  // Format value for display
  const displayValue: string | null = useMemo(() => {
    if (value == null) return null
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
