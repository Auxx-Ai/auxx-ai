// apps/web/src/components/kopilot/ui/blocks/entity-list-block.tsx

'use client'

import { getDefinitionId } from '@auxx/lib/resources/client'
import { motion } from 'motion/react'
import { useResource } from '~/components/resources'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { EntityListData } from './block-schemas'
import { EntityCardItem } from './entity-card-item'

export function EntityListBlock({ data, skipEntrance }: BlockRendererProps<EntityListData>) {
  const { recordIds, snapshot } = data
  const firstId = recordIds[0]
  const entityDefId = firstId ? getDefinitionId(firstId) : null
  const { resource } = useResource(entityDefId)

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='entity-list-block'
        indicator={
          <div
            className='size-2 rounded-full'
            style={{ backgroundColor: resource?.color ?? 'var(--muted-foreground)' }}
          />
        }
        primaryText={resource?.plural ?? 'Records'}
        secondaryText={<span className='text-xs text-muted-foreground'>{recordIds.length}</span>}
        hasFooter={false}>
        <div className='space-y-2'>
          {recordIds.map((recordId, index) => (
            <motion.div
              key={recordId}
              initial={skipEntrance ? false : { opacity: 0, scale: 0.92, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 500,
                damping: 22,
                delay: skipEntrance ? 0 : Math.min(index * 0.06, 0.4),
              }}>
              <EntityCardItem recordId={recordId} snapshot={snapshot?.[recordId]} />
            </motion.div>
          ))}
        </div>
      </BlockCard>
    </div>
  )
}
