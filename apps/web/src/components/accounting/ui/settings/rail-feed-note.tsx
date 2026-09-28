// apps/web/src/components/accounting/ui/settings/rail-feed-note.tsx
'use client'

import { processorByHandle } from '@auxx/lib/accounting/processors/client'
import type { RailFeedStatus } from '@auxx/lib/accounting/rails/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { useOptionalAppsContext } from '~/components/apps/providers/apps-context'
import { useCanManageConnectors } from '~/components/data-connectors/hooks/use-can-manage-connectors'
import { connectSourceHref } from '~/components/data-connectors/lib/connect-source-href'
import { api } from '~/trpc/react'

/** What a feed note says and which action sits beside it; null when there is nothing to say. */
export interface RailFeedCopy {
  sentence: string
  action:
    | { kind: 'link'; sourceAccountId: string }
    | { kind: 'href'; href: string; label: string }
    | { kind: 'ask'; text: string }
    | null
}

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
        sentence: `${prefix}${app} is installed. Connect it so auxx reads ${label} payouts for matching.`,
        action:
          canManageConnectors && feed.feedApp
            ? { kind: 'href', href: connectSourceHref(feed.feedApp), label: `Connect ${app}` }
            : ask,
      }
    case 'not_installed':
      return {
        sentence: `${prefix}${app} can read these payouts for matching.`,
        action:
          canManageConnectors && feed.feedApp
            ? { kind: 'href', href: connectSourceHref(feed.feedApp), label: `Install ${app}` }
            : ask,
      }
  }
}

interface RailFeedNoteProps {
  feed: RailFeedStatus | null | undefined
  /** The rail `linkFeed` points the candidate at. */
  gatewayId: string
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
        utils.paymentGateway.readiness.invalidate({ gatewayId }),
        utils.paymentGateway.list.invalidate(),
        utils.paymentGateway.listUnlinkedFeeds.invalidate(),
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
      {action?.kind === 'link' && canControl && (
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
      {action?.kind === 'ask' && <span>{action.text}</span>}
    </div>
  )
}

interface ProcessorFeedHintProps {
  /** The rail's handles, as typed or seen on orders. */
  handles: readonly string[]
  className?: string
}

/**
 * The feed nudge for a rail with no gateway yet, from the processor descriptor alone. Says
 * nothing about install or connector state because nothing here has read it.
 */
export function ProcessorFeedHint({ handles, className }: ProcessorFeedHintProps) {
  const canManageConnectors = useCanManageConnectors()
  const installations = useOptionalAppsContext()?.appInstallations
  const processor = handles.map(processorByHandle).find((p) => p?.feedApp) ?? null
  if (!processor?.feedApp) return null

  const feedApp = processor.feedApp
  const app =
    installations?.find((installation) => installation.app.slug === feedApp)?.app.title ??
    processor.label
  const prefix = processor.feeTreatment === 'billed' ? 'Optional: ' : ''

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs',
        className
      )}>
      <span>
        {prefix}
        {processor.label} payouts can be read by the {app} app for matching.
      </span>
      {canManageConnectors ? (
        <FeedHrefButton href={connectSourceHref(feedApp)} label={`Connect ${app}`} />
      ) : (
        <span>Ask whoever manages connectors to connect {app}.</span>
      )}
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
