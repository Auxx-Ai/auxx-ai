// apps/web/src/components/kopilot/ui/blocks/entity-list-block.tsx

'use client'

import { getDefinitionId } from '@auxx/lib/resources/client'
import { useResource } from '~/components/resources'
import type { BlockRendererProps } from './block-registry'
import type { EntityListData } from './block-schemas'
import { EntityCardItem } from './entity-card-item'

export function EntityListBlock({ data }: BlockRendererProps<EntityListData>) {
  const entityDefId = data.length > 0 ? getDefinitionId(data[0].recordId) : null
  const { resource } = useResource(entityDefId)

  return (
    <div className='not-prose my-2 rounded-2xl bg-card/50 p-2 shadow-xl shadow-black/[.065] ring-1 ring-border'>
      {/* Header: color dot + entity type label + count */}
      <div className='mb-2 flex items-center justify-between px-2 pt-1'>
        <div className='flex items-center gap-2'>
          <div
            className='size-2 rounded-full'
            style={{ backgroundColor: resource?.color ?? 'var(--muted-foreground)' }}
          />
          <span className='text-sm font-semibold'>{resource?.plural ?? 'Records'}</span>
        </div>
        <span className='text-xs text-muted-foreground'>{data.length}</span>
      </div>

      {/* Stacked entity cards */}
      <div className='space-y-2'>
        {data.map((item) => (
          <EntityCardItem key={item.recordId} recordId={item.recordId} />
        ))}
      </div>
    </div>
  )
}
