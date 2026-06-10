// apps/web/src/components/resources/ui/field-badge.tsx
'use client'

import { getEffectiveFieldType } from '@auxx/lib/custom-fields/client'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
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
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { type BreadcrumbSegment, SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { AlertTriangle, X } from 'lucide-react'
import { useMemo } from 'react'
import { useField, useFields, useResourceProperty } from '~/components/resources/hooks/use-field'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { recordBadgeVariants } from './record-badge'

interface FieldBadgeProps extends Pick<VariantProps<typeof recordBadgeVariants>, 'size'> {
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
  /** Whether to show the field-type icon (default: true). */
  showIcon?: boolean
  /** When set, renders a trailing X button that fires this handler on click. */
  onRemove?: () => void
  className?: string
}

/**
 * Display badge for a field reference inside an editor (CALC formulas, AI
 * prompts, binding pickers, filter chips). Self-fetches its labels from the
 * resource store via `useField`/`useFields`. Shares `recordBadgeVariants` and
 * the `skeleton`/`record-remove` data-slot structure with `RecordBadge`, so
 * field and record chips render identically side by side.
 */
export function FieldBadge({
  id,
  entityDefinitionId,
  selected,
  showIcon = true,
  onRemove,
  size,
  className,
}: FieldBadgeProps) {
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
  const hasLoadedOnce = useResourceStore((s) => s.hasLoadedOnce)

  const terminalField = isFieldPath(ref) ? pathFields[pathFields.length - 1] : singleField

  const badgeClasses = cn(
    recordBadgeVariants({ size }),
    'font-normal',
    selected && 'ring-2 ring-primary ring-offset-1',
    className
  )

  // Store not hydrated yet — skeleton instead of flashing the unknown badge.
  if (!hasLoadedOnce && !terminalField) {
    return (
      <span data-slot='field-badge' aria-busy className={badgeClasses}>
        {showIcon && <Skeleton />}
        <Skeleton />
      </span>
    )
  }

  if (!isFieldPath(ref) && !singleField) {
    return <UnknownBadge id={id} selected={selected} className={className} />
  }

  const remove = onRemove && (
    <button
      type='button'
      data-slot='record-remove'
      aria-label='Remove'
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onRemove()
      }}>
      <X />
    </button>
  )

  if (!isFieldPath(ref)) {
    return (
      <span data-slot='field-badge' className={badgeClasses}>
        {showIcon && <FieldBadgeIcon field={singleField} />}
        <span className='truncate'>{singleField!.label}</span>
        {remove}
      </span>
    )
  }

  // Path badge — SmartBreadcrumb handles truncation for long paths. Each
  // segment's label comes from the resolved ResourceField in `pathFields`.
  const segments: BreadcrumbSegment[] = ref.map((rfId, i) => ({
    id: rfId,
    label: pathFields[i]?.label ?? rfId,
  }))

  return (
    <span data-slot='field-badge' className={cn(badgeClasses, 'max-w-[280px]')}>
      {showIcon && <FieldBadgeIcon field={terminalField} />}
      <SmartBreadcrumb
        segments={segments}
        mode='display'
        size='sm'
        className='[&_[data-slot=breadcrumb-list]]:m-0! [&_[data-slot=breadcrumb-list]]:p-0!'
      />
      {remove}
    </span>
  )
}

/**
 * Leading icon for the (terminal) field — the field-type icon from
 * `fieldTypeOptions`, or the target entity's icon for relationship terminals,
 * mirroring how `FieldItem` rows render in the pickers.
 */
function FieldBadgeIcon({ field }: { field: ResourceField | undefined }) {
  const relatedEntityDefinitionId = field?.relationship
    ? getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
    : null
  const targetProps = useResourceProperty(relatedEntityDefinitionId, ['icon', 'color'])

  if (field?.relationship && targetProps) {
    return <EntityIcon iconId={targetProps.icon} color={targetProps.color} size='xs' />
  }

  const effectiveFieldType = field ? getEffectiveFieldType(field) : undefined
  const iconId =
    (effectiveFieldType &&
      fieldTypeOptions[effectiveFieldType as keyof typeof fieldTypeOptions]?.iconId) ||
    'circle'
  return <EntityIcon iconId={iconId} size='xs' className='text-muted-foreground' />
}

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
