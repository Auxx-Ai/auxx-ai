// apps/web/src/components/dynamic-table/components/cell-field-editor.tsx
'use client'

import { getFieldTypeMaxWidth, getFieldTypeMinWidth } from '@auxx/lib/custom-fields/types'
import type { RecordId } from '@auxx/lib/resources/client'
import { Popover, PopoverContent } from '@auxx/ui/components/popover'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useEffect, useMemo } from 'react'
import { getInputComponentForFieldType } from '~/components/fields/inputs/get-input-component'
import { PropertyProvider, usePropertyContext } from '~/components/fields/property-provider'
import { useFieldPopoverHandlers } from '~/components/fields/use-field-popover-handlers'
import type { CellSelectionConfig } from '../types'

interface CellFieldEditorProps {
  rowId: string
  columnId: string
  cellSelectionConfig: CellSelectionConfig
  onClose: () => void
  anchorRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Field editor popover for cell editing
 *
 * PERFORMANCE NOTE: This component is only rendered for the ONE cell
 * currently being edited. All other cells render only their display content.
 *
 * Uses PropertyProvider to leverage existing:
 * - Optimistic updates with rollback (via storeConfig)
 * - Dirty state tracking
 * - Save/cancel logic
 */
export function CellFieldEditor({
  rowId,
  columnId,
  cellSelectionConfig,
  onClose,
  anchorRef,
}: CellFieldEditorProps) {
  // Get field definition from config
  const field = cellSelectionConfig.getFieldDefinition?.(columnId)

  // Get recordId for optimistic updates (required)
  const recordId = useMemo<RecordId | undefined>(() => {
    return cellSelectionConfig.getRecordId?.(rowId)
  }, [cellSelectionConfig, rowId])

  // Close editor if field or recordId are missing (must be in effect, not during render)
  useEffect(() => {
    if (!field || !recordId) {
      onClose()
    }
  }, [field, recordId, onClose])

  if (!field || !recordId) {
    // No field definition or recordId - can't edit, effect will close
    return null
  }

  return (
    <PropertyProvider
      providerId={`cell-${rowId}-${columnId}`}
      field={field}
      loading={false}
      recordId={recordId}>
      <CellFieldEditorInner onClose={onClose} anchorRef={anchorRef} />
    </PropertyProvider>
  )
}

/**
 * Inner component that consumes PropertyContext
 */
function CellFieldEditorInner({
  onClose,
  anchorRef,
}: {
  onClose: () => void
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const { field } = usePropertyContext()

  // Use shared handlers with onClose callback
  const { handleOutsideEvent, handleEscapeKey } = useFieldPopoverHandlers({ onClose })

  // Get input component from shared function
  const InputComponent = getInputComponentForFieldType(field.fieldType)
  // if (field.type === FieldType.TEXT) {
  //   return (
  //     <div className="absolute inset-0 border border-red-500 z-50 bg-background">
  //       {InputComponent}
  //     </div>
  //   )
  // }
  return (
    <Popover open={true}>
      <PopoverPrimitive.Anchor asChild>
        <div className='absolute inset-0'></div>
      </PopoverPrimitive.Anchor>
      <PopoverContent
        align='start'
        side='bottom'
        className='p-0 border'
        style={{
          width: Math.max(
            anchorRef.current?.offsetWidth || 200,
            getFieldTypeMinWidth(field.fieldType)
          ),
          maxWidth: getFieldTypeMaxWidth(field.fieldType),
        }}
        sideOffset={4}
        alignOffset={0}
        onPointerDownOutside={handleOutsideEvent}
        onEscapeKeyDown={handleEscapeKey}>
        <div className='flex flex-col gap-2'>{InputComponent}</div>
      </PopoverContent>
    </Popover>
  )
}
