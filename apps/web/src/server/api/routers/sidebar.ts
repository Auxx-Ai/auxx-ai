// apps/web/src/server/api/routers/sidebar.ts

import { ForbiddenError } from '@auxx/lib/errors'
import { findMemberByUser } from '@auxx/lib/members'
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
import {
  createGroup,
  createSidebarFolder,
  deleteNode,
  getSidebarState,
  materializeLayout,
  moveNode,
  renameNode,
  resetLayout,
  resolveLayout,
  type SidebarMember,
  saveOrgDefault,
  setNodeHidden,
} from '@auxx/lib/sidebar-layout'
import { SIDEBAR_TITLE_MAX } from '@auxx/lib/sidebar-layout/client'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

/** A row id, or a virtual ref (`group:…`, `folder:…`, `nav:…`, `entity:…`) from the resolved tree. */
const nodeRef = z.string().min(1).max(200)
const title = z.string().trim().min(1).max(SIDEBAR_TITLE_MAX)
const position = { beforeId: nodeRef.nullish(), afterId: nodeRef.nullish() }

async function loadMember(userId: string, organizationId: string): Promise<SidebarMember> {
  const member = await findMemberByUser(organizationId, userId)
  if (!member) throw new ForbiddenError('Membership not found')
  return { organizationMemberId: member.id, organizationId: member.organizationId, userId }
}

/** Throw the AuxxError so auxxErrorMiddleware maps it to the right status. */
function unwrap<T>(result: Result<T, Error>): T {
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * The member's own sidebar layout (plans/sidebar/01-unified-sidebar.md). Every write
 * returns `{ nodes, nodeId }`: the member's full node list after the write.
 */
export const sidebarRouter = createTRPCRouter({
  /** Nodes + def projection; same shape as the dehydrated `sidebar`. Served from cache. */
  list: protectedProcedure.query(async ({ ctx }) =>
    getSidebarState(ctx.session.userId, ctx.session.organizationId)
  ),

  /** The resolved tree, unfiltered by access. */
  resolved: protectedProcedure.query(async ({ ctx }) => {
    const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
    return unwrap(await resolveLayout(ctx.db, member))
  }),

  materialize: protectedProcedure.mutation(async ({ ctx }) => {
    const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
    return unwrap(await materializeLayout(ctx.db, member))
  }),

  move: protectedProcedure
    .input(z.object({ nodeId: nodeRef, parentId: nodeRef.nullable(), ...position }))
    .mutation(async ({ ctx, input }) => {
      const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
      return unwrap(await moveNode(ctx.db, member, input))
    }),

  setHidden: protectedProcedure
    .input(z.object({ nodeId: nodeRef, isHidden: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
      return unwrap(await setNodeHidden(ctx.db, member, input))
    }),

  createGroup: protectedProcedure
    .input(z.object({ title, ...position }))
    .mutation(async ({ ctx, input }) => {
      const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
      return unwrap(await createGroup(ctx.db, member, input))
    }),

  createFolder: protectedProcedure
    .input(z.object({ parentId: nodeRef, title, ...position }))
    .mutation(async ({ ctx, input }) => {
      const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
      return unwrap(await createSidebarFolder(ctx.db, member, input))
    }),

  rename: protectedProcedure
    .input(z.object({ nodeId: nodeRef, title }))
    .mutation(async ({ ctx, input }) => {
      const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
      return unwrap(await renameNode(ctx.db, member, input))
    }),

  delete: protectedProcedure
    .input(z.object({ nodeId: nodeRef }))
    .mutation(async ({ ctx, input }) => {
      const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
      return unwrap(await deleteNode(ctx.db, member, input))
    }),

  reset: protectedProcedure.mutation(async ({ ctx }) => {
    const member = await loadMember(ctx.session.userId, ctx.session.organizationId)
    return unwrap(await resetLayout(ctx.db, member))
  }),

  /** Save the caller's layout (minus favorites) as the org default. Same gate as org settings. */
  saveOrgDefault: protectedProcedure
    .use(notDemo('change organization settings'))
    .mutation(async ({ ctx }) => {
      const { organizationId, userId } = ctx.session
      await requirePermission(userId, organizationId, PermissionKey.settingsManage)
      const member = await loadMember(userId, organizationId)
      const snapshot = unwrap(await saveOrgDefault(ctx.db, member))
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'setting.changed',
        targetType: 'OrganizationSetting',
        targetId: 'sidebar.defaultLayout',
        newState: { value: snapshot },
      })
      return snapshot
    }),
})
