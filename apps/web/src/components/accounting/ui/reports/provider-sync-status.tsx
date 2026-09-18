// apps/web/src/components/accounting/ui/reports/provider-sync-status.tsx

'use client'

import { describeProviderSyncCoverage } from '@auxx/lib/accounting/mirror/client'
import { RefreshCw } from 'lucide-react'
import { api } from '~/trpc/react'

export interface ProviderSyncStatusProps {
  /** The last date the statement covers. Empty renders nothing. */
  through: string
}

/**
 * "Synced through 2026-09-16" in the report toolbar, beside the PDF and CSV
 * buttons.
 *
 * Only the `current` reading. The other three are warnings and belong in the
 * page body where they have room to explain themselves - see
 * `provider-sync-marker.tsx`.
 */
export function ProviderSyncStatus({ through }: ProviderSyncStatusProps) {
  const { data } = api.ledgerReports.providerSyncMarker.useQuery(undefined, {
    // Shared cache entry with `ProviderSyncMarker`, so mounting both is one request.
    staleTime: 60_000,
  })

  if (!data?.connected || !through) return null

  const reading = describeProviderSyncCoverage(data, through)
  if (reading.coverage !== 'current' || !reading.headline) return null

  return (
    <span className='flex items-center gap-1.5 px-2 text-muted-foreground text-xs'>
      <RefreshCw className='size-3.5' />
      {reading.headline}
    </span>
  )
}
