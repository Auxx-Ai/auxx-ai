// apps/web/src/components/agents/ui/detail/knowledge/pinned-records-block.tsx
'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Pin, Star } from 'lucide-react'
import { useMemo } from 'react'
import { useRecords } from '~/components/resources/hooks/use-records'
import type { AgentDetail } from '../../../store/agent-store'
import { useScopeMutations } from './use-scope-mutations'

interface PinnedRecordsBlockProps {
  agent: AgentDetail
  /** Only show pins whose record-type prefix matches. Pass null for all. */
  filterPrefix: string | null
  onSavingChange?: (saving: boolean) => void
}

/**
 * Compact list of records pinned to the agent. Filtered to the active sub-tab
 * by record-type prefix. Manual pins can be unpinned via the star; mention
 * pins are read-only.
 */
export function PinnedRecordsBlock({
  agent,
  filterPrefix,
  onSavingChange,
}: PinnedRecordsBlockProps) {
  const { setPin } = useScopeMutations(agent.id, onSavingChange)

  const pins = useMemo(() => {
    if (!filterPrefix) return agent.pinnedRecords
    return agent.pinnedRecords.filter((p) => {
      const colon = p.recordId.indexOf(':')
      const prefix = colon === -1 ? p.recordId : p.recordId.slice(0, colon)
      return prefix === filterPrefix
    })
  }, [agent.pinnedRecords, filterPrefix])

  const recordIds = useMemo(() => pins.map((p) => p.recordId as RecordId), [pins])
  const { recordsByKey } = useRecords({ recordIds })

  if (pins.length === 0) {
    return (
      <p className='text-xs text-muted-foreground py-2'>
        No pinned records yet. Pin a record below to keep it always-on in the prompt.
      </p>
    )
  }

  return (
    <ul className='space-y-1'>
      {pins.map((pin) => {
        const record = recordsByKey.get(pin.recordId as RecordId)
        const title = (record?.displayName as string) ?? (record?.title as string) ?? pin.recordId
        const isMention = pin.pinReason === 'mention'
        const recordType = parseRecordId(pin.recordId as RecordId).entityDefinitionId
        return (
          <li
            key={pin.recordId}
            className='flex items-center gap-2 text-sm py-1 px-2 rounded-md hover:bg-background'>
            {isMention ? (
              <Pin className='size-4 text-primary' />
            ) : (
              <Star className='size-4 text-amber-500 fill-amber-500' />
            )}
            <span className='flex-1 truncate'>{title}</span>
            <Badge variant='outline'>{recordType}</Badge>
            <Badge variant={isMention ? 'secondary' : 'outline'}>
              {isMention ? 'By mention' : 'Manual'}
            </Badge>
            {!isMention && (
              <button
                type='button'
                onClick={() => setPin(pin.recordId, false)}
                className='text-xs underline text-muted-foreground hover:text-foreground'>
                Unpin
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
