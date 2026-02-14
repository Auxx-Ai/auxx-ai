// apps/web/src/components/dynamic-table/components/field-path-breadcrumb.tsx

'use client'

import type { BreadcrumbSegment } from '@auxx/ui/components/smart-breadcrumb'
import { SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { useMemo } from 'react'
// import { useColumnMetadataStore } from '../store/column-metadata-store'
import { getIconForFieldType } from '../custom-field-column-factory'

interface FieldPathBreadcrumbProps {
  /** Table ID for scoped metadata lookup */
  tableId: string
  /** Column ID (either ResourceFieldId or FieldPath joined by ::) */
  columnId: string
}

/**
 * Optimized breadcrumb for field path columns.
 * Reads pre-computed metadata from zustand store.
 * Displays the path as: Field1 > Field2 > Field3
 *
 * @example
 * // For columnId "product:vendor::vendor:name"
 * // Renders: Vendor › Name
 */
export function FieldPathBreadcrumb({ tableId, columnId }: FieldPathBreadcrumbProps) {
  // Read from metadata store with granular selector
  // const metadata = useColumnMetadataStore(
  //   (state) => state.tables[tableId]?.columns[columnId]
  // )

  // Build breadcrumb segments from metadata
  const segments = useMemo((): BreadcrumbSegment[] => {
    if (!metadata || metadata.type !== 'path') {
      // Fallback for direct fields or missing metadata
      return [
        {
          id: columnId,
          label: columnId,
        },
      ]
    }

    return metadata.fields.map((field, index) => ({
      id: metadata.fieldPath[index] ?? `segment-${index}`,
      label: field.label ?? field.key ?? 'Unknown',
      icon: field.fieldType ? getIconForFieldType(field.fieldType) : undefined,
    }))
  }, [columnId])

  // Show error state if metadata failed to load
  if (metadata?.loadError) {
    return <span className='text-destructive text-xs'>{metadata.loadError}</span>
  }

  return <SmartBreadcrumb segments={segments} mode='display' size='sm' />
}
