// apps/web/src/components/fields/compact-field-row.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { memo } from 'react'
import { PropertyProvider } from './property-provider'
import PropertyRow from './property-row'

interface CompactFieldRowProps {
  providerId: string
  field: any
  loading: boolean
  recordId: RecordId
  readOnly?: boolean
  onOpenChange: (providerId: string, open: boolean) => void
  registerClose: (providerId: string, closeFn: () => void) => void
  unregisterClose: (providerId: string) => void
}

/**
 * Compact analogue of the "normal mode" branch of `SortablePropertyRow`,
 * stripped of `useSortable` and the field-navigation context. Same
 * `PropertyProvider` + `PropertyRow` editing surface as the web sidebar.
 */
export const CompactFieldRow = memo(function CompactFieldRow({
  providerId,
  field,
  loading,
  recordId,
  readOnly = false,
  onOpenChange,
  registerClose,
  unregisterClose,
}: CompactFieldRowProps) {
  return (
    <div className='group/row-wrapper'>
      <PropertyProvider
        providerId={providerId}
        onOpenChange={onOpenChange}
        registerClose={registerClose}
        unregisterClose={unregisterClose}
        field={field}
        loading={loading}
        recordId={recordId}
        readOnly={readOnly}
        showTitle>
        <PropertyRow />
      </PropertyProvider>
    </div>
  )
})
