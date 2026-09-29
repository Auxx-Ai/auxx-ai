// apps/web/src/components/accounting/ui/settings/rail-feed-note.tsx
'use client'

import type { RailFeedStatus } from '@auxx/lib/accounting/rails/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useCanManageConnectors } from '~/components/data-connectors/hooks/use-can-manage-connectors'
import { SourceTemplateDialog } from '~/components/data-connectors/ui/source-template-dialog'
import { api } from '~/trpc/react'

/** What a feed note says and which action sits beside it; null when there is nothing to say. */
export interface RailFeedCopy {
  sentence: string
  action:
    | { kind: 'link'; sourceAccountId: string }
    | { kind: 'href'; href: string; label: string }
    | { kind: 'connect'; appSlug: string; label: string }
    | { kind: 'ask'; text: string }
    | null
}

const GATEWAYS_HREF = '/app/accounting/settings/payment-gateways'

/** The copy for one rail's feed state (brief 113 D2/D4); pure so the list tooltip can reuse it. */
export function railFeedCopy(
  feed: RailFeedStatus | null | undefined,
  canManageConnectors: boolean
): RailFeedCopy | null {
  if (!feed || feed.state === 'linked' || feed.state === 'none') return null
  const label = feed.processorLabel ?? feed.feedAppTitle ?? 'this processor'
  const app = feed.feedAppTitle ?? feed.processorLabel ?? 'The app'
  const prefix = feed.optional ? 'Optional: ' : ''
  const ask = { kind: 'ask' as const, text: `Ask whoever manages connectors to connect ${app}.` }

  switch (feed.state) {
    case 'available':
      return feed.candidateSourceAccountId
        ? {
            sentence: `${prefix}${/^[aeiou]/i.test(label) ? 'An' : 'A'} ${label} feed is ready.`,
            action: { kind: 'link', sourceAccountId: feed.candidateSourceAccountId },
          }
        : { sentence: `${prefix}More than one ${label} feed is ready. Pick one.`, action: null }
    case 'linked_elsewhere': {
      // Never "Optional": receipts clear here while payouts relieve the other rail, billed or not.
      const other = feed.linkedGateway
      if (!other) return null
      const handle = feed.processorHandle ?? 'this handle'
      const otherHandles = other.handles.length > 0 ? ` (${other.handles.join(', ')})` : ''
      return {
        sentence: `The ${label} feed is linked to ${other.name}${otherHandles}. Payouts for ${handle} settle there - add ${handle} to that gateway instead.`,
        action: {
          kind: 'href',
          href: `${GATEWAYS_HREF}?gateway=${encodeURIComponent(other.id)}`,
          label: `Open ${other.name}`,
        },
      }
    }
    case 'syncing':
      return {
        sentence: `${prefix}${app} is connected and has not synced payouts yet.`,
        action:
          canManageConnectors && feed.connectorId
            ? {
                kind: 'href',
                href: `/app/connectors/${feed.connectorId}?tab=streams`,
                label: 'Open connector',
              }
            : null,
      }
    case 'not_connected':
      return {
        sentence: `${prefix}${app} is installed. Connect it so auxx reads and posts ${label} payouts.`,
        action:
          canManageConnectors && feed.feedApp
            ? { kind: 'connect', appSlug: feed.feedApp, label: `Connect ${app}` }
            : ask,
      }
    case 'not_installed':
      return {
        sentence: `${prefix}${app} can read and post these payouts.`,
        action:
          canManageConnectors && feed.feedApp
            ? { kind: 'connect', appSlug: feed.feedApp, label: `Install ${app}` }
            : ask,
      }
  }
}

interface RailFeedNoteProps {
  feed: RailFeedStatus | null | undefined
  /** The rail `linkFeed` points the candidate at; without one (no gateway yet) there is no Link. */
  gatewayId?: string
  /** `PermissionKey.ledgerControl`: false hides Link; connector actions follow connector access. */
  canControl: boolean
  className?: string
}

/** One muted line saying where a rail's feed stands, with the one action that moves it on. */
export function RailFeedNote({ feed, gatewayId, canControl, className }: RailFeedNoteProps) {
  const utils = api.useUtils()
  const canManageConnectors = useCanManageConnectors()
  const linkFeed = api.paymentGateway.linkFeed.useMutation({
    onSuccess: () =>
      Promise.all([
        // Every rail's readiness: another rail may now read `linked_elsewhere`.
        utils.paymentGateway.readiness.invalidate(),
        utils.paymentGateway.list.invalidate(),
        utils.paymentGateway.listUnlinkedFeeds.invalidate(),
        utils.paymentGateway.feedStateForHandles.invalidate(),
      ]),
    onError: (error) => toastError({ title: 'Error linking the feed', description: error.message }),
  })

  const copy = railFeedCopy(feed, canManageConnectors)
  if (!copy) return null
  const { action } = copy

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs',
        className
      )}>
      <span>{copy.sentence}</span>
      {action?.kind === 'link' && canControl && gatewayId && (
        <Button
          variant='outline'
          size='xs'
          loading={linkFeed.isPending}
          loadingText='Linking...'
          onClick={() => linkFeed.mutate({ gatewayId, sourceAccountId: action.sourceAccountId })}>
          Link
        </Button>
      )}
      {action?.kind === 'href' && <FeedHrefButton href={action.href} label={action.label} />}
      {action?.kind === 'connect' && (
        <FeedConnectButton appSlug={action.appSlug} label={action.label} />
      )}
      {action?.kind === 'ask' && <span>{action.text}</span>}
    </div>
  )
}

function FeedHrefButton({ href, label }: { href: string; label: string }) {
  return (
    <Button variant='outline' size='xs' asChild>
      <Link href={href}>
        {label}
        <ArrowUpRight />
      </Link>
    </Button>
  )
}

function FeedConnectButton({ appSlug, label }: { appSlug: string; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant='outline' size='xs' onClick={() => setOpen(true)}>
        {label}
      </Button>
      <SourceTemplateDialog open={open} onOpenChange={setOpen} initialType={`app:${appSlug}`} />
    </>
  )
}
