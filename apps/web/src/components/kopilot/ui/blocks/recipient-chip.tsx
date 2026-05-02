// apps/web/src/components/kopilot/ui/blocks/recipient-chip.tsx

'use client'

import type { ActorId } from '@auxx/types/actor'
import { isActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import { isRecordId } from '@auxx/types/resource'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'

/**
 * Render one recipient string from a tool's `to` / `cc` / `bcc` array in its
 * appropriate display shape:
 *   `user:<id>` / `group:<id>` → ActorBadge (workspace member or group)
 *   `<defId>:<instId>`         → RecordBadge (contact / company / etc.)
 *   anything else              → plain text (raw email / phone / unknown)
 *
 * `isActorId` is checked before `isRecordId` because both shapes match
 * `isRecordId`'s permissive `:`-presence check; actor lookup wins.
 */
export function RecipientChip({ value }: { value: string }) {
  if (isActorId(value)) {
    return <ActorBadge actorId={value as ActorId} size='sm' />
  }
  if (isRecordId(value)) {
    return <RecordBadge recordId={value as RecordId} size='sm' />
  }
  return <span className='text-xs'>{value}</span>
}
