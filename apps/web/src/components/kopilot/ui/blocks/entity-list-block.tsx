// apps/web/src/components/kopilot/ui/blocks/entity-list-block.tsx

'use client'

import { getDefinitionId } from '@auxx/lib/resources/client'
import { motion } from 'motion/react'
import { useResource } from '~/components/resources'
import type { BlockRendererProps } from './block-registry'
import type { EntityListData } from './block-schemas'
import { EntityCardItem } from './entity-card-item'

export function EntityListBlock({ data, skipEntrance }: BlockRendererProps<EntityListData>) {
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
        {data.map((item, index) => (
          <motion.div
            key={item.recordId}
            initial={skipEntrance ? false : { opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 22,
              delay: skipEntrance ? 0 : Math.min(index * 0.06, 0.4),
            }}>
            <EntityCardItem recordId={item.recordId} />
          </motion.div>
        ))}
      </div>
    </div>
  )
}
