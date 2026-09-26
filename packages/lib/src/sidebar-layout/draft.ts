// packages/lib/src/sidebar-layout/draft.ts
// In-memory copy of a member's rows that planners mutate; the recorded ops are then written in one transaction.

import { generateId, generateKeyBetween, generateNKeysBetween } from '@auxx/utils'
import { compareSidebarNodes } from './constants'
import type { SidebarNodeEntity, SidebarSystemGroupKey } from './types'

/** The member whose rows a layout operation touches. */
export interface SidebarMember {
  organizationMemberId: string
  organizationId: string
  userId: string
}

type MutableFields = Partial<
  Pick<SidebarNodeEntity, 'parentId' | 'sortOrder' | 'isHidden' | 'title'>
>

export type LayoutOp =
  | { type: 'insert'; row: SidebarNodeEntity }
  | { type: 'update'; id: string; set: MutableFields }
  | { type: 'delete'; id: string }

export interface LayoutDraft {
  member: SidebarMember
  rows: Map<string, SidebarNodeEntity>
  ops: LayoutOp[]
  /** Virtual ref → row id for nodes this draft materialized. */
  refs: Map<string, string>
  now: string
}

export function createLayoutDraft(
  member: SidebarMember,
  rows: readonly SidebarNodeEntity[],
  now: Date = new Date()
): LayoutDraft {
  return {
    member,
    rows: new Map(rows.map((r) => [r.id, { ...r }])),
    ops: [],
    refs: new Map(),
    now: now.toISOString(),
  }
}

export interface DraftInsertInput {
  nodeType: SidebarNodeEntity['nodeType']
  parentId: string | null
  sortOrder: string
  title?: string | null
  systemKey?: SidebarSystemGroupKey | null
  targetType?: string | null
  targetIds?: Record<string, string> | null
  isHidden?: boolean
}

export function draftInsert(draft: LayoutDraft, input: DraftInsertInput): SidebarNodeEntity {
  const row: SidebarNodeEntity = {
    id: generateId(),
    organizationId: draft.member.organizationId,
    organizationMemberId: draft.member.organizationMemberId,
    userId: draft.member.userId,
    nodeType: input.nodeType,
    title: input.title ?? null,
    systemKey: input.systemKey ?? null,
    targetType: input.targetType ?? null,
    targetIds: input.targetIds ?? null,
    parentId: input.parentId,
    sortOrder: input.sortOrder,
    isHidden: input.isHidden ?? false,
    createdAt: draft.now,
    updatedAt: draft.now,
  }
  draft.rows.set(row.id, row)
  draft.ops.push({ type: 'insert', row })
  return row
}

export function draftUpdate(draft: LayoutDraft, id: string, set: MutableFields): void {
  const row = draft.rows.get(id)
  if (!row) throw new Error(`Sidebar draft: no row ${id}`)
  Object.assign(row, set, { updatedAt: draft.now })
  draft.ops.push({ type: 'update', id, set })
}

/** Delete one row. Children must have been moved first — the FK cascade is not a re-homing strategy. */
export function draftDelete(draft: LayoutDraft, id: string): void {
  for (const row of draft.rows.values()) {
    if (row.parentId === id) throw new Error(`Sidebar draft: ${id} still has children`)
  }
  draft.rows.delete(id)
  draft.ops.push({ type: 'delete', id })
}

/** Children of `parentId` (null = roots) in display order. */
export function draftChildren(draft: LayoutDraft, parentId: string | null): SidebarNodeEntity[] {
  return [...draft.rows.values()].filter((r) => r.parentId === parentId).sort(compareSidebarNodes)
}

export function draftSystemGroup(
  draft: LayoutDraft,
  systemKey: SidebarSystemGroupKey
): SidebarNodeEntity | undefined {
  for (const row of draft.rows.values()) {
    if (row.nodeType === 'GROUP' && row.systemKey === systemKey) return row
  }
  return undefined
}

export function isDraftCustomized(draft: LayoutDraft): boolean {
  for (const row of draft.rows.values()) if (row.nodeType === 'GROUP') return true
  return false
}

export function draftRows(draft: LayoutDraft): SidebarNodeEntity[] {
  return [...draft.rows.values()].sort(compareSidebarNodes)
}

/** `n` keys after the last current child of `parentId`, ignoring `excludeId`. */
export function appendKeys(
  draft: LayoutDraft,
  parentId: string | null,
  n: number,
  excludeId?: string
): string[] {
  const siblings = draftChildren(draft, parentId).filter((r) => r.id !== excludeId)
  return generateNKeysBetween(siblings.at(-1)?.sortOrder ?? null, null, n)
}

/**
 * Key for a drop between two neighbours of a sorted sibling list. `before` is the sibling
 * that ends up above, `after` the one below; `before` wins when both are given, so rows the
 * client didn't render (hidden, inaccessible) between them stay below the dropped node.
 */
export function keyBetweenNeighbors(
  siblings: readonly SidebarNodeEntity[],
  before: SidebarNodeEntity | null,
  after: SidebarNodeEntity | null
): string {
  if (before) {
    const idx = siblings.findIndex((s) => s.id === before.id)
    const next = siblings.slice(idx + 1).find((s) => s.sortOrder > before.sortOrder)
    return generateKeyBetween(before.sortOrder, next?.sortOrder ?? null)
  }
  if (after) {
    const idx = siblings.findIndex((s) => s.id === after.id)
    const prev = siblings
      .slice(0, idx)
      .reverse()
      .find((s) => s.sortOrder < after.sortOrder)
    return generateKeyBetween(prev?.sortOrder ?? null, after.sortOrder)
  }
  return generateKeyBetween(siblings.at(-1)?.sortOrder ?? null, null)
}
