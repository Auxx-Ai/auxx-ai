// apps/web/src/components/accounting/ui/ledger/outbox/rail-badge.tsx

'use client'

import { api } from '~/trpc/react'
import { SourceAccountBadge } from '../../source-account-badge'

/** The rail a row is scoped to, drawn the way the payouts list draws a processor: its mark and the rail's name. */
export function RailBadge({ railId }: { railId: string }) {
  // Archived included: this names a stored id, and a closed rail's row must still read as itself.
  const gateways = api.paymentGateway.list.useQuery({ includeArchived: true })
  const rail = gateways.data?.find((row) => row.id === railId)
  if (!rail) return null
  return (
    <SourceAccountBadge
      providerKey={rail.settlementSource}
      externalAccountId={rail.processorAccountId ?? ''}
      name={rail.name}
      size='sm'
    />
  )
}
