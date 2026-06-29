// apps/web/src/components/resources/hooks/use-connector-name.ts

'use client'

import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** The connector fields the source/lock badges need. */
export interface ResolvedConnector {
  id: string
  name: string
  /** Connector type, e.g. `"app:shopify"` | `"generic-rest"`. */
  type: string
  /** Installed-app id for app connectors; null for built-ins. Bridges to `useAppsContext`. */
  appInstallationId: string | null
}

/**
 * Resolve a DataConnector row from its id.
 *
 * Reads the org-scoped `dataConnector.list` query — React Query dedupes the
 * request so every owned/contributing cell and source badge shares one fetch.
 * The query only fires when a `connectorId` is present (the vast majority of
 * fields have none), so unmanaged grids pay nothing.
 */
export function useConnector(
  connectorId: string | null | undefined
): ResolvedConnector | undefined {
  const { data } = api.dataConnector.list.useQuery(undefined, {
    enabled: !!connectorId,
    staleTime: 5 * 60 * 1000,
  })

  return useMemo(() => {
    if (!connectorId || !data) return undefined
    const row = data.find((c) => c.id === connectorId)
    if (!row) return undefined
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      appInstallationId: row.appInstallationId ?? null,
    }
  }, [connectorId, data])
}

/**
 * Resolve a DataConnector's display name from its id for the field-lock badges.
 * Thin wrapper over {@link useConnector}.
 */
export function useConnectorName(connectorId: string | null | undefined): string | undefined {
  return useConnector(connectorId)?.name
}
