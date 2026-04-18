// apps/web/src/components/mail/thread-ticket-control.tsx
'use client'

import { getInstanceId, type RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { PanelRightOpen } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { RecordPicker } from '~/components/pickers/record-picker'
import { TicketBadge } from '~/components/resources/ui/ticket-badge'
import { useThread } from '~/components/threads/hooks'
import { useThreadContext } from './thread-provider'

/**
 * Ticket link/create/open control for the thread header.
 *
 * - Renders a single RecordPicker with a TicketBadge trigger. TicketBadge shows
 *   "#{number}" when linked, "Link ticket" label otherwise.
 * - Picker supports linking to an existing ticket, swapping, unlinking (via
 *   deselect), and zero-click creating a new ticket seeded from the thread.
 * - When linked, also renders a small "open ticket" button that opens the
 *   ticket in the sidebar via the `ticketId` URL query param (handled by
 *   MailBox).
 */
export function ThreadTicketControl() {
  const { threadId, handlers } = useThreadContext()
  const { thread } = useThread({ threadId })
  const [, setOpenTicketId] = useQueryState('ticketId', { defaultValue: '' })

  const ticketInstanceId = thread?.ticketId ? getInstanceId(thread.ticketId) : null

  const handleChange = useCallback(
    (ids: RecordId[]) => {
      const picked = ids[0] ?? null
      void handlers.linkTicket(picked ? getInstanceId(picked) : null)
    },
    [handlers]
  )

  const handleCreate = useCallback(() => {
    void handlers.createAndLinkTicket()
  }, [handlers])

  if (!thread) return null

  return (
    <div className='flex items-center gap-1'>
      <RecordPicker
        value={thread.ticketId ? [thread.ticketId] : []}
        onChange={handleChange}
        multi={false}
        entityDefinitionId='ticket'
        canCreate
        onCreate={handleCreate}
        createLabel='Create ticket from thread'>
        <button type='button' className='inline-flex items-center'>
          <TicketBadge ticketId={ticketInstanceId} />
        </button>
      </RecordPicker>

      {ticketInstanceId && (
        <Tooltip content='Open ticket'>
          <Button
            variant='ghost'
            size='icon-xs'
            className='rounded-full hover:bg-foreground/10 size-5'
            onClick={() => setOpenTicketId(ticketInstanceId)}>
            <PanelRightOpen className='size-3.5' />
            <span className='sr-only'>Open ticket</span>
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
