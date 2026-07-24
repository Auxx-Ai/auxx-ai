// apps/web/src/components/fields/rows/field-value-row.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { memo, useCallback, useEffect } from 'react'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { PropertyProvider, usePropertyContext } from '../property-provider'
import PropertyRow from '../property-row'
import type { PanelField } from './types'

/**
 * Props for FieldValueRow
 */
interface FieldValueRowProps {
  providerId: string
  field: PanelField
  /** Position in the list, used for arrow-key navigation ordering */
  index: number
  loading: boolean
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  /** Whether all fields are read-only */
  readOnly?: boolean
  /** Whether to show field titles/labels */
  showTitle?: boolean
  onOpenChange: (providerId: string, open: boolean) => void
  registerClose: (providerId: string, closeFn: () => void) => void
  unregisterClose: (providerId: string) => void
}

/**
 * Normal-mode row: renders the field's value through `PropertyProvider` +
 * `PropertyRow`, which handles display, click-to-edit and the popover editor.
 *
 * Deliberately does not call `useSortable` — reordering is edit-mode only, so a
 * value row can never be dragged.
 */
export const FieldValueRow = memo(function FieldValueRow({
  providerId,
  field,
  index,
  loading,
  recordId,
  readOnly = false,
  showTitle = true,
  onOpenChange,
  registerClose,
  unregisterClose,
}: FieldValueRowProps) {
  const nav = useFieldNavigationOptional()
  const isFocused = nav?.focusedRowId === providerId

  const handleFocus = useCallback(() => {
    nav?.setFocusedRow(providerId)
  }, [nav, providerId])

  return (
    <div data-active={isFocused || undefined} className='group/row-wrapper'>
      <PropertyProvider
        providerId={providerId}
        onOpenChange={onOpenChange}
        registerClose={registerClose}
        unregisterClose={unregisterClose}
        field={field}
        loading={loading}
        recordId={recordId}
        readOnly={readOnly}
        showTitle={showTitle}>
        <NavigatedPropertyRow providerId={providerId} index={index} onFocus={handleFocus} />
      </PropertyProvider>
    </div>
  )
})

/**
 * Registers the row with the navigation context. Lives inside `PropertyProvider`
 * because the editor's `open` function only exists in that context — registering
 * it here is what lets Enter open the focused row.
 */
const NavigatedPropertyRow = memo(function NavigatedPropertyRow({
  providerId,
  index,
  onFocus,
}: {
  providerId: string
  index: number
  onFocus: () => void
}) {
  const nav = useFieldNavigationOptional()
  const { open } = usePropertyContext()

  useEffect(() => {
    if (!nav) return
    nav.registerRow(providerId, index, open)
    return () => nav.unregisterRow(providerId)
  }, [nav, providerId, index, open])

  return <PropertyRow onFocus={onFocus} />
})
