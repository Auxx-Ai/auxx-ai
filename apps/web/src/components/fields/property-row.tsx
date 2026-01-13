// apps/web/src/components/fields/property-row.tsx
'use client'

import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { DisplayField } from './displays/display-field'
import { useCallback, useMemo } from 'react'
import { FieldInput } from './field-input'
import { usePropertyContext } from './property-provider'
import { isValueEmpty } from '@auxx/lib/field-values/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Tooltip } from '~/components/global/tooltip'
import type { FieldType } from '@auxx/database/types'

/**
 * Returns true if the value for a given field is considered empty.
 * Uses centralized formatter for consistent empty checking.
 * @param fieldType The field type string
 * @param value The value to check (raw or TypedFieldValue)
 */
function isFieldEmpty(fieldType: string, value: any): boolean {
  return isValueEmpty(value, fieldType)
}
/**
 * Renders the interactive row for a single property, including label, icon, and value.
 */
function PropertyRow({
  // editable = true,
  onEdit,
  onFocus,
}: {
  // editable?: boolean
  onEdit?: (newValue: string) => void
  /** Called when this row receives focus (for keyboard navigation) */
  onFocus?: () => void
}) {
  const { field, value, isOpen, open, isOutsideClick, isLoading, showTitle } = usePropertyContext()

  // Get iconId from field or fall back to field type's default icon
  const iconId = field.iconId ?? fieldTypeOptions[field.fieldType as FieldType]?.iconId ?? 'circle'
  const handleClick = useCallback(() => {
    if (isLoading) return
    if (field.readOnly) return

    // Set this row as focused for keyboard navigation
    onFocus?.()

    // console.log('3. onClick: isOpen:', isOpen, 'isOutsideClick:', isOutsideClick.current)
    if (!isOpen && isOutsideClick.current) open()

    isOutsideClick.current = false
  }, [field, isLoading, isOpen, open, onFocus])

  const handlePointerDown = useCallback(() => {
    if (isLoading) return
    isOutsideClick.current = true
    // console.log('1. row click: isOpen:', isOpen, 'isOutsideClick:', isOutsideClick.current)
  }, [field, isLoading, isOpen])

  const valueSection = (
    <div className="min-w-0 relative flex text-sm flex-1">
      <div className="items-center flex-1 flex gap-[4px] w-full overflow-y-auto no-scrollbar">
        {isLoading ? (
          <LoadingFieldSkeleton />
        ) : !field.readOnly ? (
          <FieldInput>
            {!isFieldEmpty(field.fieldType, value) ? <DisplayField /> : <EmptyField />}
          </FieldInput>
        ) : !isFieldEmpty(field.fieldType, value) ? (
          <DisplayField />
        ) : (
          <EmptyField />
        )}
      </div>
    </div>
  )

  return (
    <div
      // ref={anchorRef}
      className="group/property-row flex w-full h-fit row group min-h-[30px]"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      style={{ cursor: !field.readOnly && !isLoading ? 'pointer' : undefined }}
      data-slot="property-row">
      {showTitle && (
        <div className="items-center self-start flex gap-[4px] h-[24px] shrink-0">
          <EntityIcon
            iconId={iconId}
            variant="default"
            size="default"
            className="text-neutral-400 group-data-[active]/row-wrapper:text-foreground"
          />
          <div className="w-[120px] flex items-center text-sm text-neutral-400 group-data-[active]/row-wrapper:text-foreground shrink-0">
            <div className="truncate me-1">{field.name}</div>
            {field.isUnique && (
              <Badge size="xs" variant="purple">
                U
              </Badge>
            )}
          </div>
        </div>
      )}
      {!showTitle ? (
        <Tooltip align="start" side="left" content={field.name}>
          {valueSection}
        </Tooltip>
      ) : (
        valueSection
      )}
    </div>
  )
}
/**
 * Fallback view when a property has no stored value.
 */
function EmptyField() {
  return (
    <div className="rounded-lg px-1 overflow-hidden h-auto min-h-[28px] flex items-center group-hover/property-row:bg-neutral-100 group-hover/property-row:dark:bg-foreground/10">
      <div className="content-center items-center h-fit flex overflow-hidden whitespace-nowrap py-[2px] text-ellipsis text-neutral-300 dark:text-foreground/40">
        Empty
      </div>
    </div>
  )
}
/**
 * Skeleton shimmer with randomized width to keep loading states varied.
 */
function LoadingFieldSkeleton() {
  const skeletonWidth = useMemo(() => {
    const widthOptions = ['60%', '72%', '84%', '48%', '66%', '78%']
    const index = Math.floor(Math.random() * widthOptions.length)
    return widthOptions[index]
  }, [])

  return <Skeleton className="h-4 max-w-[220px]" style={{ width: skeletonWidth }} />
}
export default PropertyRow
