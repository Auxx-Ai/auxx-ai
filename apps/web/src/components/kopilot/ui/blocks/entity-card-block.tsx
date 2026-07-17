// apps/web/src/components/kopilot/ui/blocks/entity-card-block.tsx

'use client'

import type { BlockRendererProps } from './block-registry'
import type { EntityCardData } from './block-schemas'
import { EntityCardItem } from './entity-card-item'
import { useStreamSafeIds } from './use-stream-safe-ids'

export function EntityCardBlock({ data, lastValueTruncated }: BlockRendererProps<EntityCardData>) {
  // During streaming the partial-JSON parser may emit `{}` before `recordId`
  // arrives, then a half-streamed id while its string is unterminated. Skip
  // render until the id is complete — `AuxxBlock` stays mounted, so when the
  // id lands the card just fades in.
  const [recordId] = useStreamSafeIds(data.recordId ? [data.recordId] : [], lastValueTruncated)
  if (!recordId) return null
  return (
    <div className='not-prose my-2'>
      <EntityCardItem recordId={recordId} snapshot={data.snapshot} />
    </div>
  )
}
