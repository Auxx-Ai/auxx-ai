// apps/web/src/components/mail-filters/ui/blocked-senders-card.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ShieldBan } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

interface BlockedSendersCardProps {
  /** Inbox ids the caller may author filters for — the scope of this summary. */
  inboxIds: string[]
}

/**
 * Read-only cross-link to the channel's ingest-time allow/block lists (§3.5).
 *
 * The two stages are genuinely different, which is why this is a link and not a
 * merged editor:
 *
 * - **Ingest filtering is prevention.** `shouldIgnoreMessage` runs as step 1 of
 *   `storeMessage`, *before* the write: a blocked sender early-returns into
 *   `storeIgnoredMessage`, leaving a minimal dedup stub. No body, no
 *   attachments, no contacts, no counts, no realtime, no `message:received`
 *   event.
 * - **A mail filter is cleanup.** By the time it runs the mail has landed — the
 *   body is in object storage, attachments are ingested, contacts have been
 *   created per `recordCreation.mode`.
 *
 * So a filter *cannot* express "never accept mail from this sender". Anyone who
 * wants that needs the channel setting. One place to look; two places to
 * configure.
 */
export function BlockedSendersCard({ inboxIds }: BlockedSendersCardProps) {
  const { data } = api.channel.list.useQuery(undefined, { staleTime: 60_000 })

  const counts = useMemo(() => {
    const allowed = new Set(inboxIds)
    // Scoped to the caller's own authorable inboxes — this card must not
    // summarise the ingest config of mailboxes they cannot even see.
    const channels = (data?.channels ?? []).filter(
      (channel) => channel.inboxId && allowed.has(channel.inboxId)
    )
    let blockedSenders = 0
    let blockedRecipients = 0
    let allowedRecipients = 0
    for (const channel of channels) {
      const settings = channel.settings as
        | {
            excludeSenders?: string[]
            excludeRecipients?: string[]
            onlyProcessRecipients?: string[]
          }
        | null
        | undefined
      blockedSenders += settings?.excludeSenders?.length ?? 0
      blockedRecipients += settings?.excludeRecipients?.length ?? 0
      allowedRecipients += settings?.onlyProcessRecipients?.length ?? 0
    }
    return { blockedSenders, blockedRecipients, allowedRecipients, channelCount: channels.length }
  }, [data, inboxIds])

  const summary =
    counts.blockedSenders + counts.blockedRecipients + counts.allowedRecipients === 0
      ? 'No blocked or allow-listed addresses configured on your channels.'
      : [
          `${counts.blockedSenders} blocked sender${counts.blockedSenders === 1 ? '' : 's'}`,
          `${counts.blockedRecipients} blocked recipient${counts.blockedRecipients === 1 ? '' : 's'}`,
          `${counts.allowedRecipients} allow-listed recipient${counts.allowedRecipients === 1 ? '' : 's'}`,
        ].join(' · ')

  return (
    <div className='flex flex-col gap-3 rounded-xl border bg-primary-50/40 p-4 sm:flex-row sm:items-start sm:justify-between'>
      <div className='flex min-w-0 gap-3'>
        <div className='flex size-8 shrink-0 items-center justify-center rounded-xl border'>
          <ShieldBan className='size-4 text-muted-foreground' />
        </div>
        <div className='min-w-0 space-y-1'>
          <p className='text-sm font-medium text-foreground'>Blocked senders</p>
          <p className='text-sm text-muted-foreground'>{summary}</p>
          <p className='text-xs text-muted-foreground'>
            Blocking happens at the channel, one step earlier than a filter: blocked mail never
            really lands: no body, no attachments, no contacts, nothing on the timeline. A filter
            runs after the mail has landed and moves it. So a filter can archive a newsletter, but
            only a channel block can stop accepting it in the first place.
          </p>
        </div>
      </div>
      <Button asChild variant='outline' size='sm' className='shrink-0'>
        <Link href='/app/settings/channels'>Channel settings</Link>
      </Button>
    </div>
  )
}
