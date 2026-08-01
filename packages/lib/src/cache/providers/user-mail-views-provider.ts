// packages/lib/src/cache/providers/user-mail-views-provider.ts

import { MailViewService } from '../../mail-views'
import { SYSTEM_VISIBILITY } from '../../permissions/visibility/context'
import type { CacheProvider } from '../org-cache-provider'
import type { CachedMailView } from '../user-cache-keys'

/** Computes mail views for a user in a specific org. Receives "userId:orgId" as the compute ID. */
export const userMailViewsProvider: CacheProvider<CachedMailView[]> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userMailViews: ${compositeId}`)
    }

    // View definitions only (no thread queries) — SYSTEM viewer is safe here.
    const mailViewService = new MailViewService(organizationId, db, SYSTEM_VISIBILITY, {
      enableCache: false,
    })
    const views = await mailViewService.getAllUserAccessibleMailViews(userId)

    return views.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      isDefault: v.isDefault,
      isPinned: v.isPinned,
      isShared: v.isShared,
      // The API vocabulary is `filterGroups`; the column is `filters`
      // (`mail-view-service.ts` maps the same way on both read and write).
      // Reading `v.filterGroups` here was always `undefined`.
      filterGroups: (v.filters as unknown[] | null) ?? [],
      sortField: v.sortField,
      sortDirection: v.sortDirection === 'asc' ? 'asc' : v.sortDirection === 'desc' ? 'desc' : null,
      organizationId: v.organizationId,
      userId: v.userId,
      createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : String(v.createdAt),
      updatedAt: v.updatedAt instanceof Date ? v.updatedAt.toISOString() : String(v.updatedAt),
    }))
  },
}
