// packages/lib/src/sidebar-layout/sidebar-mutations.ts
// Layout writes. Every write locks the member row, plans in memory, then writes the ops in one transaction.
// No permission checks here: members only ever touch their own rows (scoped by organizationMemberId).

import { type Database, schema, type Transaction } from '@auxx/database'
import { eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { onCacheEvent } from '../cache/invalidate'
import { updateOrganizationSetting } from '../settings/settings-service'
import { SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY } from './constants'
import {
  createLayoutDraft,
  draftRows,
  type LayoutDraft,
  type LayoutOp,
  type SidebarMember,
} from './draft'
import { listMemberSidebarNodes } from './node-reads'
import {
  type LayoutEnv,
  type MoveNodeInput,
  materializeDraft,
  planCreateFolder,
  planCreateGroup,
  planDeleteNode,
  planMoveNode,
  planRenameNode,
  planResetLayout,
  planSetHidden,
} from './plan'
import { resolveSidebarLayout } from './resolve'
import { loadLayoutEnv } from './sidebar-queries'
import { snapshotFromLayout } from './snapshot'
import type { SidebarLayoutSnapshot, SidebarMutationResult } from './types'

type Planner = (draft: LayoutDraft, env: LayoutEnv) => Result<string | null, Error>

/**
 * Run one planner against the member's rows under a row lock on the membership, so two
 * concurrent first edits cannot both materialize. Busts `userSidebar` after commit.
 */
export async function runLayoutMutation(
  db: Database,
  member: SidebarMember,
  planner: Planner
): Promise<Result<SidebarMutationResult, Error>> {
  let wrote = false
  let outcome: Result<SidebarMutationResult, Error>
  try {
    const env = await loadLayoutEnv(member.organizationId)
    outcome = await db.transaction(async (tx) => {
      await tx
        .select({ id: schema.OrganizationMember.id })
        .from(schema.OrganizationMember)
        .where(eq(schema.OrganizationMember.id, member.organizationMemberId))
        .for('update')
      const rows = await listMemberSidebarNodes(tx, member.organizationMemberId)
      const draft = createLayoutDraft(member, rows)
      const planned = planner(draft, env)
      if (planned.isErr()) return err(planned.error)
      await applyLayoutOps(tx, draft.ops)
      wrote = draft.ops.length > 0
      return ok({
        nodes: draftRows(draft),
        nodeId: planned.value,
        refs: Object.fromEntries(draft.refs),
      })
    })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
  if (wrote) {
    await onCacheEvent('sidebar.changed', { userId: member.userId, orgId: member.organizationId })
  }
  return outcome
}

/** Write planned ops in order; consecutive inserts and deletes are batched. */
async function applyLayoutOps(tx: Transaction, ops: readonly LayoutOp[]): Promise<void> {
  let i = 0
  while (i < ops.length) {
    const op = ops[i]!
    if (op.type === 'insert') {
      const batch: (typeof schema.SidebarNode.$inferInsert)[] = []
      while (i < ops.length && ops[i]!.type === 'insert') {
        const { row } = ops[i] as Extract<LayoutOp, { type: 'insert' }>
        batch.push({
          id: row.id,
          organizationId: row.organizationId,
          organizationMemberId: row.organizationMemberId,
          userId: row.userId,
          nodeType: row.nodeType,
          title: row.title,
          systemKey: row.systemKey,
          targetType: row.targetType,
          targetIds: row.targetIds,
          parentId: row.parentId,
          sortOrder: row.sortOrder,
          isHidden: row.isHidden,
        })
        i++
      }
      await tx.insert(schema.SidebarNode).values(batch)
    } else if (op.type === 'delete') {
      const ids: string[] = []
      while (i < ops.length && ops[i]!.type === 'delete') {
        ids.push((ops[i] as Extract<LayoutOp, { type: 'delete' }>).id)
        i++
      }
      await tx.delete(schema.SidebarNode).where(inArray(schema.SidebarNode.id, ids))
    } else {
      await tx
        .update(schema.SidebarNode)
        .set({ ...op.set, updatedAt: new Date() })
        .where(eq(schema.SidebarNode.id, op.id))
      i++
    }
  }
}

/** Copy the resolved default into the member's own rows (§4). Idempotent. */
export function materializeLayout(
  db: Database,
  member: SidebarMember
): Promise<Result<SidebarMutationResult, Error>> {
  return runLayoutMutation(db, member, (draft, env) => {
    materializeDraft(draft, env)
    return ok(null)
  })
}

/** Move a node to `parentId` between two siblings. Refs may be virtual (`nav:…`, `group:…`). */
export function moveNode(
  db: Database,
  member: SidebarMember,
  input: MoveNodeInput
): Promise<Result<SidebarMutationResult, Error>> {
  return runLayoutMutation(db, member, (draft, env) => planMoveNode(draft, env, input))
}

export function setNodeHidden(
  db: Database,
  member: SidebarMember,
  input: { nodeId: string; isHidden: boolean }
): Promise<Result<SidebarMutationResult, Error>> {
  return runLayoutMutation(db, member, (draft, env) => planSetHidden(draft, env, input))
}

export function createGroup(
  db: Database,
  member: SidebarMember,
  input: { title: string; beforeId?: string | null; afterId?: string | null }
): Promise<Result<SidebarMutationResult, Error>> {
  return runLayoutMutation(db, member, (draft, env) => planCreateGroup(draft, env, input))
}

export function createSidebarFolder(
  db: Database,
  member: SidebarMember,
  input: { parentId: string; title: string; beforeId?: string | null; afterId?: string | null }
): Promise<Result<SidebarMutationResult, Error>> {
  return runLayoutMutation(db, member, (draft, env) => planCreateFolder(draft, env, input))
}

export function renameNode(
  db: Database,
  member: SidebarMember,
  input: { nodeId: string; title: string }
): Promise<Result<SidebarMutationResult, Error>> {
  return runLayoutMutation(db, member, (draft, env) => planRenameNode(draft, env, input))
}

export function deleteNode(
  db: Database,
  member: SidebarMember,
  input: { nodeId: string }
): Promise<Result<SidebarMutationResult, Error>> {
  return runLayoutMutation(db, member, (draft, env) => planDeleteNode(draft, env, input))
}

/** Drop the member's own layout and fall back to the org default; favorites survive. */
export function resetLayout(
  db: Database,
  member: SidebarMember
): Promise<Result<SidebarMutationResult, Error>> {
  return runLayoutMutation(db, member, (draft, env) => planResetLayout(draft, env))
}

/**
 * Save the member's current layout as the org default, minus favorites. The caller
 * (router) asserts the member may change org settings.
 */
export async function saveOrgDefault(
  db: Database,
  member: SidebarMember
): Promise<Result<SidebarLayoutSnapshot, Error>> {
  try {
    const [nodes, env] = await Promise.all([
      listMemberSidebarNodes(db, member.organizationMemberId),
      loadLayoutEnv(member.organizationId),
    ])
    const snapshot = snapshotFromLayout(resolveSidebarLayout({ nodes, ...env }))
    await updateOrganizationSetting({
      organizationId: member.organizationId,
      key: SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY,
      value: snapshot,
      db,
    })
    return ok(snapshot)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
