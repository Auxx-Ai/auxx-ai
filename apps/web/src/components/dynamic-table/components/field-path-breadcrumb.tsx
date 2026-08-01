// apps/web/src/components/dynamic-table/components/field-path-breadcrumb.tsx

'use client'

import type { BreadcrumbSegment } from '@auxx/ui/components/smart-breadcrumb'
import { SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { useMemo } from 'react'
import { useFields } from '~/components/resources/hooks/use-field'
import { getIconForFieldType } from '../custom-field-column-factory'
import { decodeColumnId } from '../utils/column-id'

interface FieldPathBreadcrumbProps {
  /** Column ID (either ResourceFieldId or FieldPath joined by ::) */
  columnId: string
}

/**
 * Breadcrumb for field path columns.
 * Resolves each segment of the path against the resource-field store.
 * Displays the path as: Field1 > Field2 > Field3
 *
 * @example
 * // For columnId "product:vendor::vendor:name"
 * // Renders: Vendor › Name
 */
export function FieldPathBreadcrumb({ columnId }: FieldPathBreadcrumbProps) {
  const decoded = useMemo(() => decodeColumnId(columnId), [columnId])
  const isPathColumn = decoded.type === 'path'

  const pathFields = useFields(decoded.type === 'path' ? decoded.fieldPath : [])

  // Build breadcrumb segments from the resolved fields
  const segments = useMemo((): BreadcrumbSegment[] => {
    if (decoded.type !== 'path') {
      // Fallback for direct fields
      return [{ id: columnId, label: columnId }]
    }

    return decoded.fieldPath.map((resourceFieldId, index) => {
      const field = pathFields[index]
      return {
        id: resourceFieldId,
        label: field?.label ?? field?.key ?? resourceFieldId,
        icon: field?.fieldType ? getIconForFieldType(field.fieldType) : undefined,
      }
    })
  }, [columnId, decoded, pathFields])

  // Nothing resolved yet for a path column — fall back to the raw id rather
  // than rendering an empty breadcrumb.
  if (isPathColumn && segments.length === 0) {
    return <span className='text-muted-foreground text-xs'>{columnId}</span>
  }

  return <SmartBreadcrumb segments={segments} mode='display' size='sm' />
}
