// packages/lib/src/cache/providers/user-sidebar-provider.ts

import { listSidebarNodes } from '../../sidebar-layout/node-reads'
import type { SidebarNodeEntity } from '../../sidebar-layout/types'
import type { CacheProvider } from '../org-cache-provider'

/** Every SidebarNode row of a user in one org. Receives "userId:orgId" as the compute ID. */
export const userSidebarProvider: CacheProvider<SidebarNodeEntity[]> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userSidebar: ${compositeId}`)
    }
    return listSidebarNodes(db, userId, organizationId)
  },
}
