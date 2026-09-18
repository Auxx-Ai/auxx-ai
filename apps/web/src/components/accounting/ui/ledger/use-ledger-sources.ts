// apps/web/src/components/accounting/ui/ledger/use-ledger-sources.ts
//
// Resolves a `GlPosting`/`ExportBatch` `storeId` (`FinancialSourceAccount.id`)
// or `railId` (`payment_gateway` id) to its display name, off `ledger.roleMap`'s
// `sources` list - the same `RoleSourceRow[]` the role-mapping tree's store/rail
// pickers already read (task 47 §7.4, task 58 §6.1). No new endpoint: both id
// spaces are already resolved there in one call.

import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** The id's first 8 characters, for a name this list has not resolved yet. */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

export function useLedgerSources() {
  const query = api.ledger.roleMap.useQuery()
  const sources = query.data?.sources ?? []

  const byId = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources])

  return {
    isLoading: query.isPending,
    /** `null` in, `null` out - a batch with no store/rail scope names none. */
    sourceName: (id: string | null): string | null => {
      if (!id) return null
      return byId.get(id) ?? shortId(id)
    },
  }
}
