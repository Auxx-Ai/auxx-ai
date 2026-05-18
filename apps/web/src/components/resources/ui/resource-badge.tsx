// apps/web/src/components/resources/ui/resource-badge.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle } from 'lucide-react'
import { useResourceProperty } from '~/components/resources/hooks/use-field'

interface ResourceBadgeProps {
  /** entityDefinitionId or apiSlug */
  id: string
  selected?: boolean
  className?: string
}

/**
 * Display badge for a resource reference (entity *type*, not an instance)
 * inside an editor. Mirrors `FieldBadge`'s visual shell so the two sit
 * cleanly together in chip-density prose.
 */
export function ResourceBadge({ id, selected, className }: ResourceBadgeProps) {
  const props = useResourceProperty(id, ['label', 'icon', 'color'])

  if (!props) return <UnknownBadge id={id} selected={selected} className={className} />

  return (
    <Badge
      variant='secondary'
      className={cn(
        resourceBadgeBaseClasses,
        selected && 'ring-2 ring-primary ring-offset-1',
        className
      )}>
      <EntityIcon iconId={props.icon} color={props.color} size='xs' />
      {props.label}
    </Badge>
  )
}

const resourceBadgeBaseClasses = cn(
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
