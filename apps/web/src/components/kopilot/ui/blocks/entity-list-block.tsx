// apps/web/src/components/kopilot/ui/blocks/entity-list-block.tsx

'use client'

import { getDefinitionId } from '@auxx/lib/resources/client'
import { motion } from 'motion/react'
import { useResource } from '~/components/resources'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { EntityListData } from './block-schemas'
import { EntityCardItem } from './entity-card-item'
import { isPlausibleRecordId } from './plausible-record-id'
import { useStreamSafeIds } from './use-stream-safe-ids'

export function EntityListBlock({
  data,
  lastValueTruncated,
  skipEntrance,
}: BlockRendererProps<EntityListData>) {
  // Ids are model-authored; drop anything that isn't a plausible
  // `entityDef:instance` id, since it could never resolve to a record — an
  // app-block WORKFLOW NODE id has a colon and would otherwise become a row of
  // "Record unavailable".
  const recordIds = useStreamSafeIds(data.recordIds ?? [], lastValueTruncated).filter(
    isPlausibleRecordId
  )
  const snapshot = data.snapshot
  const firstId = recordIds[0]
  const entityDefId = firstId ? getDefinitionId(firstId) : null
  const { resource } = useResource(entityDefId)

  // Nothing addressable: either the fence is still streaming its first id, or
  // the model emitted a list that holds no records at all (live run: an empty
  // `{"recordIds": []}` after a workflow tool). Both used to render as a bare
  // "Records 0" card — render nothing instead. `AuxxBlock` stays mounted, so a
  // streaming list still fades in the moment its first id lands.
  if (recordIds.length === 0) return null

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
