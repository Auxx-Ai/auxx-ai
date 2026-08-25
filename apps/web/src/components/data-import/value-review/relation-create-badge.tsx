// apps/web/src/components/data-import/value-review/relation-create-badge.tsx

'use client'

import type { RelationCreateRequest } from '@auxx/lib/import/client'
import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Plus } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useResource } from '~/components/resources'

/** What the badge announces will be minted when the import runs. */
export type ValueCreateDescriptor =
  | { kind: 'relation'; request: RelationCreateRequest }
  /** A select/tags option; `label` is the trimmed cell text to be minted. */
  | { kind: 'option'; label: string }

interface ValueCreateBadgeProps {
  create: ValueCreateDescriptor
}

/** Relation arm split out so `useResource` is only mounted when needed. */
function RelationCreateContent({ request }: { request: RelationCreateRequest }) {
  const { resource } = useResource(request.entityDefinitionId)
  const label = resource?.label ?? 'record'

  return (
    <Tooltip
      content={`A new ${label} will be created with ${request.matchField} = "${request.value}".`}>
      <span className='inline-flex'>
        <Badge variant='blue' size='sm' className='shrink-0'>
          {resource ? (
            <EntityIcon
              iconId={resource.icon}
              color={'color' in resource ? resource.color : undefined}
              size='xs'
            />
          ) : (
            <Plus />
          )}
          New {label}
        </Badge>
      </span>
    </Tooltip>
  )
}

/**
 * "Will be created", the render for the `'create'` resolution status — for both
 * pending relation creates and pending select-option creates.
 *
 * Nothing is minted until execution: this is a statement of intent, and it stays
 * overridable per value (pick an existing option/record, or skip it) right up
 * until the import runs.
 */
export function ValueCreateBadge({ create }: ValueCreateBadgeProps) {
  if (create.kind === 'relation') {
    return <RelationCreateContent request={create.request} />
  }

  return (
    <Tooltip content={`A new option "${create.label}" will be created when the import runs.`}>
      <span className='inline-flex'>
        <Badge variant='blue' size='sm' className='shrink-0'>
          <Plus />
          New option
        </Badge>
      </span>
    </Tooltip>
  )
}
