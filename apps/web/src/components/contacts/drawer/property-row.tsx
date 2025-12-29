// apps/web/src/components/contacts/drawer/property-row.tsx
'use client'

import { type LucideIcon } from 'lucide-react'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { DisplayField } from '../displays/display-field'
import { useCallback, useMemo } from 'react'
import { FieldInput } from './field-input'
import { usePropertyContext } from './property-provider'
import { FieldType } from '@auxx/database/enums'
import { Skeleton } from '@auxx/ui/components/skeleton'
/**
 * Returns true if the value for a given field is considered empty, depending on the field type.
 * @param field The field definition object (must have a 'type' property)
 * @param value The unwrapped value to check
 */
function isFieldEmpty(
  field: {
    type: string
  },
  value: any
): boolean {
  // FieldType.
  switch (field.type) {
    case FieldType.TEXT:
    case FieldType.EMAIL:
    case FieldType.URL:
    case FieldType.ADDRESS:
    case FieldType.PHONE_INTL:
    case FieldType.RICH_TEXT:
      return !value || String(value).trim() === ''
    case FieldType.NUMBER:
      return value === null || value === undefined || value === ''
    case FieldType.DATE:
    case FieldType.DATETIME:
    case FieldType.TIME:
      return !value || isNaN(new Date(value).getTime())
    case FieldType.SINGLE_SELECT:
      return value === null || value === undefined || value === ''
    case FieldType.MULTI_SELECT:
      return !Array.isArray(value) || value.length === 0
    case FieldType.CHECKBOX:
      return value === null || value === undefined
    case FieldType.TAGS:
      return (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.every((tag) => !tag || String(tag).trim() === '')
      )
    case FieldType.ADDRESS_STRUCT:
      return (
        value === null ||
        value === undefined ||
        (typeof value === 'object' &&
          Object.values(value).every((v) => v === null || v === undefined || v === ''))
      )
    case FieldType.FILE: {
      // FILE fields store { attachmentIds: string[] | string | null }
      if (!value) return true
      const ids = value.attachmentIds
      if (!ids) return true
      if (Array.isArray(ids)) return ids.length === 0
      return false
    }
    default:
      return value === null || value === undefined
  }
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
  const { field, value, isOpen, open, isOutsideClick, isLoading } = usePropertyContext()
  let Icon
  if (field && field.icon) {
    Icon = field.icon as LucideIcon
  } else {
    Icon = fieldTypeOptions.find((option) => option.value === field.type)?.icon
  }
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

  return (
    <div
      // ref={anchorRef}
      className="group/property-row flex w-full h-fit row group min-h-[30px]"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      style={{ cursor: !field.readOnly && !isLoading ? 'pointer' : undefined }}>
      <div className="items-center self-start flex gap-[4px] h-[24px] shrink-0">
        {Icon && (
          <Icon className="h-4 w-4 text-neutral-400 group-data-[active]/row-wrapper:text-foreground shrink-0" />
        )}
        <div className="w-[120px] text-sm text-neutral-400 group-data-[active]/row-wrapper:text-foreground shrink-0">
          <div className="truncate">{field.name}</div>
        </div>
      </div>
      <div className="min-w-0 relative flex text-sm flex-1">
        <div className="items-center flex-1 flex gap-[4px] w-full overflow-y-auto no-scrollbar">
          {isLoading ? (
            <LoadingFieldSkeleton />
          ) : !field.readOnly ? (
            <FieldInput>
              {!isFieldEmpty(field, value) ? <DisplayField /> : <EmptyField />}
            </FieldInput>
          ) : !isFieldEmpty(field, value) ? (
            <DisplayField />
          ) : (
            <EmptyField />
          )}
        </div>
      </div>
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
