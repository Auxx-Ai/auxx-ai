// apps/web/src/components/data-connectors/ui/connector-resync-banner.tsx
'use client'

import { Banner } from '@auxx/ui/components/banner'
import { Button } from '@auxx/ui/components/button'
import { Info, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { RouterOutputs } from '~/trpc/react'

type ResyncPending = NonNullable<RouterOutputs['dataConnector']['getStatus']['resyncPending']>

interface ConnectorResyncBannerProps {
  /** From `getStatus().resyncPending` — null/undefined ⇒ nothing pending, no banner. */
  pending: ResyncPending | null | undefined
  /** Trigger the deferred full re-crawl (`backfillPendingChange`). */
  onBackfill: () => void
  isBackfilling: boolean
}

/**
 * Advisory banner surfacing a pending mapping-edit re-sync (Layer 3). The actual
 * safety already ran at save time; this only offers to run the deferred re-crawl that
 * repopulates history. `rebackfill` reads as info ("records don't reflect the change
 * yet"); `rebind` reads as a warning ("records will be re-linked"). Pinned between the
 * page header and content by the flex layout — never scrolls away. Dismiss hides it
 * for the session; it reappears on reload until the backfill clears `resyncPending`.
 */
export function ConnectorResyncBanner({
  pending,
  onBackfill,
  isBackfilling,
}: ConnectorResyncBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  if (!pending || dismissed) return null

  const isRebind = pending.level === 'rebind'
  const n = pending.itemCount
  const records = `${n} ${n === 1 ? 'record' : 'records'}`

  return (
    <Banner
      variant={isRebind ? 'warning' : 'info'}
      icon={isRebind ? <TriangleAlert /> : <Info />}
      title={isRebind ? 'Matching changed' : 'Mapping changed'}
      onClose={() => setDismissed(true)}
      action={
        <Button
          variant='outline'
          size='sm'
          loading={isBackfilling}
          loadingText='Backfilling...'
          onClick={onBackfill}>
          <RefreshCw />
          Backfill now
        </Button>
      }>
      {isRebind
        ? `You changed how records are matched — ${records} will be re-linked on the next backfill.`
        : `${records} don't reflect this change yet.`}
    </Banner>
  )
}
