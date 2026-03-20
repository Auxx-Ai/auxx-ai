// packages/lib/src/cache/providers/build-organizations-provider.ts

import { listUserOrganizations } from '@auxx/services/organization-members'
import { createScopedLogger } from '../../logger'
import type { BuildCachedOrganization } from '../build-user-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('build-orgs-provider')

/** Computes organizations the user belongs to */
export const buildOrganizationsProvider: CacheProvider<BuildCachedOrganization[]> = {
  async compute(userId) {
    const result = await listUserOrganizations({ userId })

    if (result.isErr()) {
      logger.error('Failed to fetch organizations for user', { error: result.error, userId })
      throw new Error(`Failed to fetch organizations: ${result.error.message}`)
    }

    return result.value.map((org) => ({
      id: org.id,
      name: org.name,
      handle: org.handle,
      slug: org.handle,
    }))
  },
}
