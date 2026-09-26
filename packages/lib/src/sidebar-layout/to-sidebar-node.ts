// packages/lib/src/sidebar-layout/to-sidebar-node.ts

import type { schema } from '@auxx/database'
import { isSystemGroupKey } from './constants'
import type { SidebarNodeEntity } from './types'

type SidebarNodeRow = typeof schema.SidebarNode.$inferSelect

/** DB row → JSON-serializable node (Date → ISO string). */
export function toSidebarNodeEntity(row: SidebarNodeRow): SidebarNodeEntity {
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationMemberId: row.organizationMemberId,
    userId: row.userId,
    nodeType: row.nodeType,
    title: row.title,
    systemKey: isSystemGroupKey(row.systemKey) ? row.systemKey : null,
    targetType: row.targetType,
    targetIds: (row.targetIds as Record<string, string> | null) ?? null,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    isHidden: row.isHidden,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}
