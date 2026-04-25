// apps/web/src/components/fields/property-row.tsx
'use client'

import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { isAiField } from '@auxx/lib/custom-fields/client'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { isValueEmpty } from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useCallback, useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useFieldAiState } from '~/components/resources/hooks/use-field-values'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { AiGeneratingIndicator } from './ai-overlay/ai-generating-indicator'
import { SparkleBadge } from './ai-overlay/sparkle-badge'
import { DisplayField } from './displays/display-field'
import { FieldInput } from './field-input'
import { usePropertyContext } from './property-provider'

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
  const { field, value, recordId, isOpen, open, isOutsideClick, isLoading, showTitle } =
    usePropertyContext()
  const { saveFieldValue } = useSaveFieldValue()

  // Get iconId from field or fall back to field type's default icon
  const iconId = field.iconId ?? fieldTypeOptions[field.fieldType as FieldType]?.iconId ?? 'circle'

  // AI state is always subscribed (React hook rules); `aiEnabled` only gates
  // whether we render the badge/shimmer. The store lookup is cheap and keyed.
  const aiState = useFieldAiState(recordId, field.id)
  const isGenerating = aiState?.status === 'generating'

  // `isAiField` reads `field.type` + `options.ai.enabled`; property-row uses
  // `field.fieldType` on the registry projection, so we adapt the shape here.
  const aiEnabled =
    !!field.fieldType &&
    isAiField({ type: field.fieldType, options: field.options } as CustomFieldEntity) &&
    !field.readOnly &&
    !field.isSystem &&
    !isLoading

  const generate = () => {
    saveFieldValue(recordId, field.id, null, field.fieldType, { ai: true })
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: isOutsideClick is a stable ref
  const handleClick = useCallback(() => {
    if (isLoading) return
    if (field.readOnly) return

    // Set this row as focused for keyboard navigation
    onFocus?.()

    // console.log('3. onClick: isOpen:', isOpen, 'isOutsideClick:', isOutsideClick.current)
    if (!isOpen && isOutsideClick.current) open()

    isOutsideClick.current = false
  }, [field, isLoading, isOpen, open, onFocus])

  // biome-ignore lint/correctness/useExhaustiveDependencies: isOutsideClick is a stable ref
  const handlePointerDown = useCallback(() => {
    if (isLoading) return
    isOutsideClick.current = true
    // console.log('1. row click: isOpen:', isOpen, 'isOutsideClick:', isOutsideClick.current)
  }, [isLoading])

  const valueSection = (
    <div className='min-w-0 relative flex text-sm flex-1'>
      <div className='items-center flex-1 flex gap-[4px] w-full overflow-y-auto no-scrollbar'>
        {isLoading ? (
          <LoadingFieldSkeleton />
        ) : isGenerating ? (
          <GeneratingField />
        ) : !field.readOnly ? (
          <FieldInput>
            {!isValueEmpty(value, field.fieldType) ? <DisplayField /> : <EmptyField />}
          </FieldInput>
        ) : !isValueEmpty(value, field.fieldType) ? (
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
      className='group/property-row flex w-full h-fit row group min-h-[30px]'
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      style={{ cursor: !field.readOnly && !isLoading ? 'pointer' : undefined }}
      data-slot='property-row'>
      {showTitle && (
        <div className='items-center self-start flex gap-[4px] h-[24px] shrink-0'>
          <EntityIcon
            iconId={iconId}
            variant='default'
            size='default'
            className='text-neutral-400 group-data-[active]/row-wrapper:text-foreground'
          />
          <div className='w-[120px] flex items-center text-sm text-neutral-400 group-data-[active]/row-wrapper:text-foreground shrink-0'>
            <div className='truncate me-1'>{field.name}</div>
            {field.isUnique && (
              <Badge size='xs' variant='purple'>
                U
              </Badge>
            )}
            {aiEnabled && (
              <SparkleBadge
                variant='inline'
                metadata={aiState?.metadata}
                onClick={generate}
                isGenerating={isGenerating}
                errorMessage={
                  aiState?.status === 'error'
                    ? (aiState?.metadata?.errorMessage ?? 'AI generation failed')
                    : undefined
                }
              />
            )}
          </div>
        </div>
      )}
      {!showTitle ? (
        <Tooltip align='start' side='left' content={field.name}>
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
    <div className='rounded-lg px-1 overflow-hidden h-auto min-h-[28px] flex items-center group-hover/property-row:bg-neutral-100 group-hover/property-row:dark:bg-foreground/10'>
      <div className='content-center items-center h-fit flex overflow-hidden whitespace-nowrap py-[2px] text-ellipsis text-neutral-300 dark:text-foreground/40'>
        Empty
      </div>
    </div>
  )
}
/**
 * Value-slot view while AI generation is in flight. Mirrors `EmptyField`'s
 * row chrome so the layout doesn't jump when generation starts/ends.
 */
function GeneratingField() {
  return (
    <div className='relative rounded-lg px-1 overflow-hidden h-auto min-h-[28px] flex items-center w-full'>
      {/* <div className='pointer-events-none absolute inset-0 scale-100 opacity-75 blur-lg transition-all duration-300 dark:opacity-50'>
        <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-x-6 inset-y-3 from-pink-400 to-purple-400' />
      </div> */}
      <AiGeneratingIndicator className='relative z-10 whitespace-nowrap py-[2px]' />
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

  return <Skeleton className='h-4 max-w-[220px]' style={{ width: skeletonWidth }} />
}
export default PropertyRow
