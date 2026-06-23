// apps/web/src/components/resources/hooks/use-connector-name.ts

'use client'

import { useMemo } from 'react'
import { api } from '~/trpc/react'

/**
 * Resolve a DataConnector's display name from its id for the field-lock badges.
 *
 * Reads the org-scoped `dataConnector.list` query — React Query dedupes the
 * request so every owned/contributing cell shares one fetch. The query only
 * fires when a `connectorId` is present (the vast majority of fields have none),
 * so unmanaged grids pay nothing.
 */
export function useConnectorName(connectorId: string | null | undefined): string | undefined {
  const { data } = api.dataConnector.list.useQuery(undefined, {
    enabled: !!connectorId,
    staleTime: 5 * 60 * 1000,
  })

  return useMemo(() => {
    if (!connectorId || !data) return undefined
    return data.find((c) => c.id === connectorId)?.name
  }, [connectorId, data])
}
