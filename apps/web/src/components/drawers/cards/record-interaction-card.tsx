// apps/web/src/components/drawers/cards/record-interaction-card.tsx
'use client'

import { format } from 'date-fns'
import { ArrowDownLeft, ArrowUpRight, Mail } from 'lucide-react'
import Link from 'next/link'
import { useRecord } from '~/components/resources/hooks/use-record'
import { useMessage } from '~/components/threads/hooks/use-message'
import { useMessageParticipants } from '~/components/threads/hooks/use-message-participants'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * One interaction row: the timestamp comes from the record's own column; the
 * message ref resolves through the id-first mail surface (`useMessage` →
 * message store → lens-gated `message.getByIds`), so direction, counterpart
 * and the thread deep-link only render when the viewer's mail lens admits the
 * message. Lens denial, a hard-deleted message (channel disconnect) or a
 * missing `inboxes.view` all degrade the same way: date shown, who/link
 * withheld — the message id itself is not a capability.
 */
function InteractionRow({
  label,
  at,
  messageId,
}: {
  label: string
  at: string | Date
  messageId: string | null
}) {
  const { message } = useMessage({ messageId, enabled: !!messageId })
  const { from, to } = useMessageParticipants(message?.participants ?? [])

  const date = format(new Date(at), 'MMM d, yyyy')
  const direction = message ? (message.isInbound ? 'inbound' : 'outbound') : null

  // Direction-based "who" copy (plan §6.1): counterpart name when they wrote,
  // "You" when we did.
  let who: string | null = null
  if (direction === 'inbound') {
    who = from?.displayName ? `${from.displayName} wrote` : 'They wrote'
  } else if (direction === 'outbound') {
    const counterpart = to[0]?.displayName
    who = counterpart ? `You wrote to ${counterpart}` : 'You wrote'
  }

  const icon =
    direction === 'inbound' ? (
      <ArrowDownLeft className='size-3.5 text-muted-foreground shrink-0' />
    ) : direction === 'outbound' ? (
      <ArrowUpRight className='size-3.5 text-muted-foreground shrink-0' />
    ) : (
      <Mail className='size-3.5 text-muted-foreground shrink-0' />
    )

  const body = (
    <div className='flex items-center gap-2 min-w-0'>
      {icon}
      <div className='flex flex-col min-w-0'>
        <span className='text-sm truncate'>{date}</span>
        {who && <span className='text-xs text-muted-foreground truncate'>{who}</span>}
      </div>
    </div>
  )

  return (
    <div className='flex items-center justify-between gap-3 py-1.5'>
      <span className='text-xs text-muted-foreground shrink-0 w-28'>{label}</span>
      {message?.threadId ? (
        <Link
          href={`/app/mail/inbox/open/${message.threadId}`}
          className='min-w-0 hover:underline underline-offset-2'>
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  )
}

/**
 * RecordInteractionCard — "First interaction" / "Last interaction" rows for
 * contact and company panels (records/interaction-fields plan Phase 5). The
 * `first/lastInteractionAt(+MessageId)` columns ride the normal record payload
 * (`record.getByIds` projects the full EntityInstance row); no bespoke fetch
 * path exists for this card.
 *
 * Renders nothing when the record has no correspondence yet.
 */
export function RecordInteractionCard({ recordId }: DrawerTabProps) {
  const { record } = useRecord({ recordId })

  const firstAt = record?.firstInteractionAt as string | Date | null | undefined
  const lastAt = record?.lastInteractionAt as string | Date | null | undefined
  if (!firstAt && !lastAt) return null

  return (
    <div className='bg-primary-100/50 rounded-2xl border py-1.5 px-3 flex flex-col divide-y'>
      {firstAt && (
        <InteractionRow
          label='First interaction'
          at={firstAt}
          messageId={(record?.firstInteractionMessageId as string | null | undefined) ?? null}
        />
      )}
      {lastAt && (
        <InteractionRow
          label='Last interaction'
          at={lastAt}
          messageId={(record?.lastInteractionMessageId as string | null | undefined) ?? null}
        />
      )}
    </div>
  )
}
