// apps/web/src/hooks/use-overages.ts
'use client'

import { useDehydratedOrganization } from '~/providers/dehydrated-state-provider'

export function useOverages(organizationId?: string) {
  const org = useDehydratedOrganization(organizationId)
  return org?.overages ?? []
}

export function useHasOverages(organizationId?: string) {
  const overages = useOverages(organizationId)
  return overages.length > 0
}
