// apps/web/src/components/accounting/ui/reports/provider-sync-marker.tsx

'use client'

import { describeProviderSyncCoverage } from '@auxx/lib/accounting/mirror/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { CloudOff, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { WARNING_ROW } from '../tone-rows'

export interface ProviderSyncMarkerProps {
  /**
   * The LAST date this statement covers - `asOf` for a balance sheet, an aging
   * or a trial balance, `to` for a P&L or a general ledger. Empty while the
   * page has not resolved a period yet, which renders nothing.
   */
  through: string
}

/**
 * The two warning readings of the sync marker, above the statement: `behind`
 * (the range ends after the sync got to) and `never_synced`.
 *
 * `current` renders in the toolbar instead (`provider-sync-status.tsx`), and an
 * org with no provider renders nothing at all - a marker there would imply a
 * connection exists.
 *
 * see plans/accounting/tasks/20-two-authors-one-ledger.md §7.3
 */
export function ProviderSyncMarker({ through }: ProviderSyncMarkerProps) {
  const { data } = api.ledgerReports.providerSyncMarker.useQuery(undefined, {
    // Moves only when a sync runs; shared with `ProviderSyncStatus` in the toolbar.
    staleTime: 60_000,
  })
  const [isOpen, setIsOpen] = useState(false)

  if (!data?.connected || !through) return null

  const reading = describeProviderSyncCoverage(data, through)
  if (!reading.headline) return null

  // `current` is the toolbar's, not the page's - see `provider-sync-status.tsx`.
  if (reading.coverage === 'current') return null

  const Icon = reading.coverage === 'never_synced' ? CloudOff : TriangleAlert

  return (
    <TreeRow
      expandable={!!reading.detail}
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((open) => !open)}
      rowClassName={WARNING_ROW}
      icon={<Icon className='size-4 text-yellow-600 dark:text-yellow-500' />}
      title={
        <span className='truncate text-yellow-700 dark:text-yellow-500'>{reading.headline}</span>
      }>
      {/* `ps-6` clears the connector `BaseTreeRow` draws at the parent icon's center. */}
      {reading.detail && (
        <p className='pe-2 pt-1 pb-2 ps-6 text-muted-foreground text-sm'>{reading.detail}</p>
      )}
    </TreeRow>
  )
}
