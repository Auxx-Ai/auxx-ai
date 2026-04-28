// apps/web/src/components/resources/ui/record-hover-card-field.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { RecordId } from '@auxx/lib/resources/client'
import {
  type FieldPath,
  type FieldReference,
  isFieldPath,
  type ResourceFieldId,
} from '@auxx/types/field'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { memo, useMemo } from 'react'
import { type CellConfig, renderCellValue } from '~/components/dynamic-table'
import { useField } from '~/components/resources/hooks/use-field'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'

interface RecordHoverCardFieldProps {
  recordId: RecordId
  fieldRef: FieldReference
  className?: string
}

/**
 * Read-only field row for `RecordHoverCard`. Pulls value + metadata from the
 * shared resource store. Returns `null` when the value is empty so empty
 * fields don't clutter the preview.
 */
export const RecordHoverCardField = memo(function RecordHoverCardField({
  recordId,
  fieldRef,
  className,
}: RecordHoverCardFieldProps) {
  const targetResourceFieldId = useMemo(() => {
    if (isFieldPath(fieldRef)) {
      const path = fieldRef as FieldPath
      return path[path.length - 1] as ResourceFieldId
    }
    return fieldRef as ResourceFieldId
  }, [fieldRef])

  const { value, isLoading } = useFieldValue(recordId, fieldRef, { autoFetch: true })
  const field = useField(targetResourceFieldId)

  if (isLoading && value === undefined) {
    return <Skeleton className='h-4 w-24' />
  }

  const isEmpty = value === null || value === undefined
  if (isEmpty) return null

  const fieldType = field?.fieldType
  const iconId = fieldType
    ? (fieldTypeOptions[fieldType as FieldType]?.iconId ?? 'circle')
    : 'circle'
  const type = fieldType ?? 'TEXT'
  const config: CellConfig = { options: field?.options, disableNestedHoverCard: true }

  return (
    <div className={cn('flex items-center gap-2 text-xs', className)}>
      <div className='flex w-24 shrink-0 items-center gap-1.5 text-muted-foreground'>
        <EntityIcon iconId={iconId} variant='default' size='xs' />
        <span className='truncate'>{field?.label ?? ''}</span>
      </div>
      <div className='min-w-0 flex flex-1 truncate [&_[data-slot=expandable-cell]]:min-h-7'>
        {renderCellValue(value, type, undefined, config)}
      </div>
    </div>
  )
})
