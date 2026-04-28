// apps/web/src/components/resources/ui/field-badge.tsx
'use client'

import {
  type FieldPath,
  isFieldPath,
  isPlainFieldId,
  keyToFieldRef,
  type ResourceFieldId,
  toFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import { type BreadcrumbSegment, SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'
import { useField, useFields } from '~/components/resources/hooks/use-field'

interface FieldBadgeProps {
  /**
   * Encoded `FieldReference` key produced by `fieldRefToKey`. Three
   * accepted shapes (decoded via `keyToFieldRef`):
   *   - Plain `FieldId` (no `:`) — scoped to `entityDefinitionId`
   *   - `ResourceFieldId` (`"entityDef:fieldId"`)
   *   - FieldPath key (`"a:b::c:d"`)
   */
  id: string
  /** Entity context for plain-`FieldId` resolution. */
  entityDefinitionId: string
  selected?: boolean
  className?: string
}

/**
 * Display badge for a field reference inside an editor (CALC formulas, AI
 * prompts, future filter chips). Self-fetches its labels from the
 * resource store via `useField`/`useFields` — callers don't hand
 * `availableFields` arrays anymore.
 */
export function FieldBadge({ id, entityDefinitionId, selected, className }: FieldBadgeProps) {
  const ref: ResourceFieldId | FieldPath = useMemo(() => {
    if (isPlainFieldId(id)) {
      return toResourceFieldId(entityDefinitionId, toFieldId(id))
    }
    return keyToFieldRef(id) as ResourceFieldId | FieldPath
  }, [id, entityDefinitionId])

  // Hook calls must be unconditional — pass null/empty for the unused
  // branch and useField/useFields handle it.
  const singleField = useField(isFieldPath(ref) ? null : ref)
  const pathFields = useFields(isFieldPath(ref) ? ref : [])

  if (!isFieldPath(ref)) {
    if (!singleField) return <UnknownBadge id={id} selected={selected} className={className} />
    return (
      <Badge
        variant='secondary'
        className={cn(
          fieldBadgeBaseClasses,
          selected && 'ring-2 ring-primary ring-offset-1',
          className
        )}>
        {singleField.label}
      </Badge>
    )
  }

  // Path badge — SmartBreadcrumb handles truncation for long paths. Each
  // segment's label comes from the resolved ResourceField in `pathFields`.
  const segments: BreadcrumbSegment[] = ref.map((rfId, i) => ({
    id: rfId,
    label: pathFields[i]?.label ?? rfId,
  }))

  return (
    <Badge
      variant='secondary'
      className={cn(
        fieldBadgeBaseClasses,
        'max-w-[280px]',
        selected && 'ring-2 ring-primary ring-offset-1',
        className
      )}>
      <SmartBreadcrumb
        segments={segments}
        mode='display'
        size='sm'
        className='[&_[data-slot=breadcrumb-list]]:m-0! [&_[data-slot=breadcrumb-list]]:p-0!'
      />
    </Badge>
  )
}

/**
 * Shared base classes mirroring `RecordBadge`'s default variant + default
 * size, so field badges sit visually next to record badges in editors and
 * filter chips without drift.
 */
const fieldBadgeBaseClasses = cn(
  'flex items-center rounded-[5px] ring-1 py-0',
  'cursor-default ring-neutral-300 bg-neutral-100 text-neutral-600',
  'dark:text-neutral-100 dark:bg-muted dark:ring-neutral-800',
  'h-5 gap-1.5 ps-0.5 pe-1.5 text-sm font-normal'
)

function UnknownBadge({
  id,
  selected,
  className,
}: {
  id: string
  selected?: boolean
  className?: string
}) {
  return (
    <Badge
      variant='destructive'
      className={cn(
        'gap-1 text-xs font-normal',
        selected && 'ring-2 ring-primary ring-offset-1',
        className
      )}>
      <AlertTriangle className='h-3 w-3' />
      {id}
    </Badge>
  )
}
