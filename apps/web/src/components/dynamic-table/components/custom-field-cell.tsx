// apps/web/src/components/dynamic-table/components/custom-field-cell.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  type FieldPath,
  type FieldReference,
  isFieldPath,
  type ResourceFieldId,
} from '@auxx/types/field'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { memo, useMemo } from 'react'
import { useField } from '~/components/resources/hooks/use-field'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'
import { decodeColumnId } from '../utils/column-id'
import { CellPadding, FormattedCell } from './formatted-cell'

interface CustomFieldCellProps {
  /** Record ID (entityDefinitionId:rowId) */
  recordId: RecordId
  /** Column ID - can be ResourceFieldId or encoded FieldPath (with ::) */
  columnId: string
  /** @deprecated Field options - now fetched via useField hook for reactivity */
  options?: unknown
}

/**
 * Custom field cell - extracts FieldReference from columnId, delegates rendering to FormattedCell.
 * Handles both direct fields and paths uniformly.
 *
 * For paths, displays the terminal field value using the terminal field's type for rendering.
 * Supports has_many relationships that return arrays.
 */
export const CustomFieldCell = memo(function CustomFieldCell({
  recordId,
  columnId,
  options: propOptions,
}: CustomFieldCellProps) {
  // Decode columnId to FieldReference
  const { fieldRef, isPath } = useMemo(() => {
    const decoded = decodeColumnId(columnId)
    if (decoded.type === 'path') {
      return { fieldRef: decoded.fieldPath as FieldReference, isPath: true }
    }
    return { fieldRef: decoded.resourceFieldId as FieldReference, isPath: false }
  }, [columnId])

  // Direct store subscription using FieldReference
  // autoFetch ensures isLoading=true on first render (queues synchronously)
  const { value, isLoading } = useFieldValue(recordId, fieldRef, { autoFetch: true })

  // Get target field metadata (last element for paths)
  const targetResourceFieldId = useMemo(() => {
    if (isPath) {
      const path = fieldRef as FieldPath
      return path[path.length - 1]
    }
    return fieldRef as ResourceFieldId
  }, [fieldRef, isPath])

  const field = useField(targetResourceFieldId)
  const options = field?.options ?? propOptions

  // Use effectiveFieldType for rendering (handles CALC fields automatically)
  const fieldType = field?.effectiveFieldType

  if (isLoading && value === undefined) {
    return (
      <CellPadding>
        <Skeleton className='h-5 w-20' />
      </CellPadding>
    )
  }

  // Delegate ALL rendering to FormattedCell (including array handling)
  return (
    <FormattedCell
      value={value}
      fieldType={fieldType}
      columnId={columnId}
      options={options}
      isFieldPath={isPath}
    />
  )
})
