// apps/web/src/components/accounting/ui/use-account-link-states.ts

'use client'

import { useMemo } from 'react'
import { useAccountingProviderStatus } from '~/components/accounting/hooks/use-accounting-provider-status'
import { api } from '~/trpc/react'
import { type AccountLinkState, accountLinkState } from './settings/accounts-types'

export interface AccountLinkStates {
  /**
   * A provider is connected, it returned a chart, and the round trip has
   * landed. False is the answer for an org with nothing connected, which `P1`
   * makes a supported configuration rather than an error - a caller renders NO
   * link badges at all in that case rather than a column of "Not linked".
   */
  ready: boolean
  /** `'QuickBooks Online'`, or null with nothing connected. Never hardcode it. */
  providerLabel: string | null
  /** The link state per `gl_account` id. Empty until the round trip resolves. */
  byAccountId: ReadonlyMap<string, AccountLinkState>
}

/**
 * Every account's {@link AccountLinkState}, for a surface that wants to
 * DECORATE a chart it already has.
 *
 * 🛑 `ledger.accountMap` is a PROVIDER ROUND TRIP - it fetches QuickBooks' whole
 * chart - where `ledger.chartAccounts` is a local read. Never call this from a
 * component that is mounted for the life of a page: mount it with the surface
 * that shows the badges (a picker's popover content, which Radix unmounts when
 * closed) so an org that never opens one never pays for it. React Query dedupes
 * the key, so N pickers open at once are still one request.
 *
 * 🛑 It DECORATES, it never SOURCES. Nothing may wait on this: a provider
 * outage, an expired token or a revoked connection must cost the badges and
 * nothing else. That is why `ready` exists instead of an `isLoading` a caller
 * would be tempted to spin on.
 */
export function useAccountLinkStates(): AccountLinkStates {
  const query = api.ledger.accountMap.useQuery()
  // A context read, not a query - `useAppsContext` is already mounted app-wide.
  const provider = useAccountingProviderStatus()

  return useMemo(() => {
    const data = query.data
    // 🛑 Gate on the PROVIDER, never on an empty `rows` array - the same rule
    // `accounts-settings-page.tsx` builds `ChartMapView.connected` by. "Nothing
    // is connected" and "connected but nothing mapped" are different answers.
    const connected = !!data && data.providerId !== 'none' && data.providerAccounts.length > 0

    return {
      ready: connected && !query.isPending,
      providerLabel: provider.providerLabel,
      byAccountId: new Map(
        (data?.rows ?? []).map((row) => [row.account.id, accountLinkState(row)])
      ),
    }
  }, [query.data, query.isPending, provider.providerLabel])
}
