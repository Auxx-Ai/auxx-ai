// packages/lib/src/sidebar-layout/__tests__/support/fixtures.ts

import type { SidebarMember } from '../../draft'
import type { ResolvedSidebarLayout, SidebarNodeEntity } from '../../types'

export const MEMBER: SidebarMember = {
  organizationMemberId: 'mem1',
  organizationId: 'org1',
  userId: 'user1',
}

export const NAV_IDS = ['agents', 'dispatch', 'workflows'] as const

export const RESOURCES = [
  { id: 'def_contact', sidebar: 'on' as const },
  { id: 'def_parcel', sidebar: 'off' as const },
  { id: 'def_line', sidebar: 'never' as const },
]

export function node(partial: Partial<SidebarNodeEntity> & { id: string }): SidebarNodeEntity {
  return {
    organizationId: MEMBER.organizationId,
    organizationMemberId: MEMBER.organizationMemberId,
    userId: MEMBER.userId,
    nodeType: 'ITEM',
    title: null,
    systemKey: null,
    targetType: null,
    targetIds: null,
    parentId: null,
    sortOrder: 'a0',
    isHidden: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

export function favorite(id: string, sortOrder: string, parentId: string | null = null) {
  return node({
    id,
    sortOrder,
    parentId,
    targetType: 'WORKFLOW',
    targetIds: { workflowId: `wf_${id}` },
  })
}

export function folder(id: string, sortOrder: string, parentId: string | null = null, title = id) {
  return node({ id, nodeType: 'FOLDER', title, sortOrder, parentId })
}

/** Compact view of a layout: group title → child descriptors. */
export function outline(layout: ResolvedSidebarLayout): Record<string, string[]> {
  const describe = (c: {
    kind: string
    title?: string
    targetType?: string
    targetIds?: Record<string, string>
    isHidden: boolean
  }) => {
    const label =
      c.kind === 'FOLDER'
        ? `folder:${c.title}`
        : c.targetType === 'NAV'
          ? `nav:${c.targetIds!.navId}`
          : c.targetType === 'ENTITY_DEFINITION'
            ? `entity:${c.targetIds!.entityDefinitionId}`
            : `fav:${Object.values(c.targetIds ?? {})[0]}`
    return c.isHidden ? `${label}(hidden)` : label
  }
  const out: Record<string, string[]> = {}
  for (const group of layout.groups) {
    out[group.title] = group.children.flatMap((c) =>
      c.kind === 'FOLDER'
        ? [describe(c), ...c.children.map((i) => `  ${describe(i)}`)]
        : [describe(c)]
    )
  }
  return out
}
