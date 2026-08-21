// apps/web/src/components/data-import/value-review/relation-create-badge.tsx

'use client'

import type { RelationCreateRequest } from '@auxx/lib/import/client'
import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Plus } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useResource } from '~/components/resources'

interface RelationCreateBadgeProps {
  request: RelationCreateRequest
}

/**
 * "Will be created", the render for the `'create'` resolution status.
 *
 * The status has been declared and produced for a long time with nothing
 * rendering it, so a pending relation create looked like an unresolved value.
 * Nothing is minted until execution: this is a statement of intent, and it stays
 * overridable per value (link it to an existing record, or skip it) right up
 * until the import runs.
 */
export function RelationCreateBadge({ request }: RelationCreateBadgeProps) {
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
