// apps/web/src/components/dynamic-table/components/cell-field-editor.tsx
'use client'

import { useCallback, useMemo } from 'react'
import { Popover, PopoverContent } from '@auxx/ui/components/popover'
import { Popover as PopoverPrimitive } from 'radix-ui'
import type { CellSelectionConfig } from '../types'
import {
  PropertyProvider,
  usePropertyContext,
  type StoreConfig,
} from '~/components/fields/property-provider'
import { useFieldPopoverHandlers } from '~/components/fields/use-field-popover-handlers'
import { getInputComponentForFieldType } from '~/components/fields/inputs/get-input-component'
import { getFieldTypeMinWidth, getFieldTypeMaxWidth } from '@auxx/lib/custom-fields/types'
import { FieldType } from '@auxx/database/enums'
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
  // Get field definition and initial value from config
  const field = cellSelectionConfig.getFieldDefinition?.(columnId)
  const initialValue = cellSelectionConfig.getCellValue?.(rowId, columnId)

  // Get store config for optimistic updates (if available)
  const storeConfig = useMemo<StoreConfig | undefined>(() => {
    return cellSelectionConfig.getStoreConfig?.(rowId)
  }, [cellSelectionConfig, rowId])

  // Create mutation function that PropertyProvider expects (legacy path when no storeConfig)
  // PropertyProvider now passes raw values directly (no { data: x } wrapping)
  const handleMutate = useCallback(
    async (rawValue: any) => {
      await cellSelectionConfig.onCellValueChange?.(rowId, columnId, rawValue)
    },
    [rowId, columnId, cellSelectionConfig]
  )

  if (!field) {
    // No field definition - can't edit
    onClose()
    return null
  }

  return (
    <PropertyProvider
      providerId={`cell-${rowId}-${columnId}`}
      field={field}
      value={!storeConfig ? initialValue : undefined}
      mutate={!storeConfig ? handleMutate : undefined}
      loading={false}
      storeConfig={storeConfig}>
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
  const InputComponent = getInputComponentForFieldType(field.type)
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
        <div className="absolute inset-0"></div>
      </PopoverPrimitive.Anchor>
      <PopoverContent
        align="start"
        side="bottom"
        className="p-0 border"
        style={{
          width: Math.max(anchorRef.current?.offsetWidth || 200, getFieldTypeMinWidth(field.type)),
          maxWidth: getFieldTypeMaxWidth(field.type),
        }}
        sideOffset={4}
        alignOffset={0}
        onPointerDownOutside={handleOutsideEvent}
        onEscapeKeyDown={handleEscapeKey}>
        <div className="flex flex-col gap-2">{InputComponent}</div>
      </PopoverContent>
    </Popover>
  )
}
