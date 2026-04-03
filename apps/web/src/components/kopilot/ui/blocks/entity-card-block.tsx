// apps/web/src/components/kopilot/ui/blocks/entity-card-block.tsx

'use client'

import type { BlockRendererProps } from './block-registry'
import type { EntityCardData } from './block-schemas'
import { EntityCardItem } from './entity-card-item'

export function EntityCardBlock({ data }: BlockRendererProps<EntityCardData>) {
  return (
    <div className='not-prose my-2'>
      <EntityCardItem recordId={data.recordId} />
    </div>
  )
}
