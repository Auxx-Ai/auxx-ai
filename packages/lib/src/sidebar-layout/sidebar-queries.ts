// packages/lib/src/sidebar-layout/sidebar-queries.ts

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { getOrgCache, getUserCache } from '../cache'
import { readOrganizationSettings } from '../settings/read'
import type { SidebarMember } from './draft'
import { listMemberSidebarNodes } from './node-reads'
import type { LayoutEnv } from './plan'
import { resolveSidebarLayout } from './resolve'
import { parseSidebarLayoutSnapshot } from './snapshot'
import type { DehydratedSidebar, ResolvedSidebarLayout, SidebarLayoutSnapshot } from './types'

/** The org default snapshot, from the cached org settings. */
export async function getOrgDefaultLayout(
  organizationId: string
): Promise<SidebarLayoutSnapshot | null> {
  const settings = await readOrganizationSettings(organizationId, [
    'sidebar.defaultLayout',
  ] as const)
  return parseSidebarLayoutSnapshot(settings['sidebar.defaultLayout'])
}

/** Snapshot + def list a layout planner needs, both from the org cache. */
export async function loadLayoutEnv(organizationId: string): Promise<LayoutEnv> {
  const [snapshot, resources] = await Promise.all([
    getOrgDefaultLayout(organizationId),
    getOrgCache().get(organizationId, 'resourceNav'),
  ])
  return { snapshot, resources }
}

/** Same shape as the dehydrated `sidebar`, served from the user + org caches. */
export async function getSidebarState(
  userId: string,
  organizationId: string
): Promise<DehydratedSidebar> {
  const [nodes, resourceNav] = await Promise.all([
    getUserCache().get(userId, 'userSidebar', organizationId),
    getOrgCache().get(organizationId, 'resourceNav'),
  ])
  return { nodes, resourceNav }
}

/** The member's layout tree, unfiltered by access (the client filters). */
export async function resolveLayout(
  db: Database,
  member: SidebarMember
): Promise<Result<ResolvedSidebarLayout, Error>> {
  try {
    const [nodes, env] = await Promise.all([
      listMemberSidebarNodes(db, member.organizationMemberId),
      loadLayoutEnv(member.organizationId),
    ])
    return ok(resolveSidebarLayout({ nodes, ...env }))
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
