// packages/lib/src/cache/providers/user-mail-views-provider.ts

import { MailViewService } from '../../mail-views'
import type { CacheProvider } from '../org-cache-provider'
import type { CachedMailView } from '../user-cache-keys'

/** Computes mail views for a user in a specific org. Receives "userId:orgId" as the compute ID. */
export const userMailViewsProvider: CacheProvider<CachedMailView[]> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userMailViews: ${compositeId}`)
    }

    const mailViewService = new MailViewService(organizationId, db, { enableCache: false })
    const views = await mailViewService.getAllUserAccessibleMailViews(userId)

    return views.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      isDefault: v.isDefault,
      isPinned: v.isPinned,
      isShared: v.isShared,
      filterGroups: v.filterGroups as unknown[],
      sortField: v.sortField,
      sortDirection: v.sortDirection,
      organizationId: v.organizationId,
      userId: v.userId,
      createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : String(v.createdAt),
      updatedAt: v.updatedAt instanceof Date ? v.updatedAt.toISOString() : String(v.updatedAt),
    }))
  },
}
