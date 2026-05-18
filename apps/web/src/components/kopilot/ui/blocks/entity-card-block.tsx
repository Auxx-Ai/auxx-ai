// apps/web/src/components/kopilot/ui/blocks/entity-card-block.tsx

'use client'

import type { BlockRendererProps } from './block-registry'
import type { EntityCardData } from './block-schemas'
import { EntityCardItem } from './entity-card-item'

export function EntityCardBlock({ data }: BlockRendererProps<EntityCardData>) {
  // During streaming the partial-JSON parser may emit `{}` before `recordId`
  // arrives. Skip render until we have something useful — `AuxxBlock` stays
  // mounted, so when the id lands the card just fades in.
  if (!data.recordId) return null
  return (
    <div className='not-prose my-2'>
      <EntityCardItem recordId={data.recordId} snapshot={data.snapshot} />
    </div>
  )
}
