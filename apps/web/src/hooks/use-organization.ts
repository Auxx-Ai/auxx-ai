// apps/web/src/hooks/use-organization.ts
import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { useDehydratedOrganizations } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'

/**
 * Hook to get the current organization from dehydrated state
 * Combines organization ID from context with organization data
 * @returns Current organization or null if not found
 */
export function useOrganization(): DehydratedOrganization | null {
  const organizations = useDehydratedOrganizations()
  const { organizationId } = useOrganizationIdContext()

  if (!organizationId) return null

  return organizations.find((org) => org.id === organizationId) ?? null
}
