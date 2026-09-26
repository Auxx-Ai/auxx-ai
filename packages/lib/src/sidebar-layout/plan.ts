// packages/lib/src/sidebar-layout/plan.ts
// Pure layout planners over a LayoutDraft. Each returns the affected row id; the caller writes draft.ops.
// Rules: plans/sidebar/01-unified-sidebar.md §4–§6.

import { generateNKeysBetween } from '@auxx/utils'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError, NotFoundError } from '../errors'
import { FAVORITES_CAP } from '../favorites/client'
import {
  countFavoriteBudget,
  DEFAULT_SIDEBAR_NAV_IDS,
  isFavoriteItem,
  isSystemGroupKey,
  parseSidebarRef,
  SIDEBAR_SYSTEM_GROUP_TITLES,
  sidebarRef,
} from './constants'
import {
  appendKeys,
  draftChildren,
  draftDelete,
  draftInsert,
  draftSystemGroup,
  draftUpdate,
  isDraftCustomized,
  keyBetweenNeighbors,
  type LayoutDraft,
} from './draft'
import { homeGroupFor, resolveSidebarLayout } from './resolve'
import type {
  ResourceNavEntry,
  SidebarLayoutSnapshot,
  SidebarNodeEntity,
  SidebarSystemGroupKey,
} from './types'

/** What a planner needs besides the member's rows. */
export interface LayoutEnv {
  snapshot: SidebarLayoutSnapshot | null
  resources: readonly Pick<ResourceNavEntry, 'id' | 'sidebar'>[]
  navIds?: readonly string[]
}

type PlanResult = Result<string | null, Error>

/** Virtual ref → row id for nodes created by the materialization in this draft. */
type KeyMap = Map<string, string>

const FAVORITES_GROUP_REF = sidebarRef.group('favorites')

/**
 * Copy the resolved default into rows (§4): groups, folders, NAV and ENTITY_DEFINITION
 * items, and re-parent the member's root favorites under the new Favorites group.
 * No-op once the member has a GROUP row.
 */
export function materializeDraft(draft: LayoutDraft, env: LayoutEnv): KeyMap {
  const keyMap: KeyMap = draft.refs
  if (isDraftCustomized(draft)) return keyMap

  const layout = resolveSidebarLayout({
    nodes: [...draft.rows.values()],
    snapshot: env.snapshot,
    resources: env.resources,
    navIds: env.navIds,
  })
  const groupKeys = generateNKeysBetween(null, null, layout.groups.length)

  layout.groups.forEach((group, gi) => {
    const groupRow = draftInsert(draft, {
      nodeType: 'GROUP',
      parentId: null,
      sortOrder: groupKeys[gi]!,
      title: group.title,
      systemKey: group.systemKey,
      isHidden: group.isHidden,
    })
    keyMap.set(group.key, groupRow.id)

    const childKeys = generateNKeysBetween(null, null, group.children.length)
    group.children.forEach((child, ci) => {
      const sortOrder = childKeys[ci]!
      if (child.nodeId) {
        draftUpdate(draft, child.nodeId, { parentId: groupRow.id, sortOrder })
        return
      }
      if (child.kind === 'ITEM') {
        const row = draftInsert(draft, {
          nodeType: 'ITEM',
          parentId: groupRow.id,
          sortOrder,
          targetType: child.targetType,
          targetIds: child.targetIds,
          isHidden: child.isHidden,
        })
        keyMap.set(child.key, row.id)
        return
      }
      const folderRow = draftInsert(draft, {
        nodeType: 'FOLDER',
        parentId: groupRow.id,
        sortOrder,
        title: child.title,
        isHidden: child.isHidden,
      })
      keyMap.set(child.key, folderRow.id)
      const itemKeys = generateNKeysBetween(null, null, child.children.length)
      child.children.forEach((item, ii) => {
        if (item.nodeId) return
        const row = draftInsert(draft, {
          nodeType: 'ITEM',
          parentId: folderRow.id,
          sortOrder: itemKeys[ii]!,
          targetType: item.targetType,
          targetIds: item.targetIds,
          isHidden: item.isHidden,
        })
        keyMap.set(item.key, row.id)
      })
    })
  })

  return keyMap
}

/**
 * Find the row a ref names, after materialization. Unplaced NAV / ENTITY_DEFINITION
 * refs and missing system groups get a row on demand, appended to their home group.
 */
function resolveRef(
  draft: LayoutDraft,
  env: LayoutEnv,
  keyMap: KeyMap,
  ref: string
): SidebarNodeEntity | null {
  const mapped = keyMap.get(ref)
  if (mapped) return draft.rows.get(mapped) ?? null

  const parsed = parseSidebarRef(ref)
  if (parsed.kind === 'row') return draft.rows.get(parsed.id) ?? null
  if (parsed.kind === 'folder') return null
  if (parsed.kind === 'group') {
    if (!isSystemGroupKey(parsed.key)) return null
    return ensureSystemGroupRow(draft, parsed.key)
  }

  const targetType = parsed.kind === 'nav' ? 'NAV' : 'ENTITY_DEFINITION'
  const idKey = parsed.kind === 'nav' ? 'navId' : 'entityDefinitionId'
  for (const row of draft.rows.values()) {
    if (row.targetType === targetType && row.targetIds?.[idKey] === parsed.key) return row
  }

  let isHidden = false
  if (parsed.kind === 'nav') {
    if (!(env.navIds ?? DEFAULT_SIDEBAR_NAV_IDS).includes(parsed.key)) return null
  } else {
    const def = env.resources.find((r) => r.id === parsed.key)
    if (!def || def.sidebar === 'never') return null
    isHidden = def.sidebar === 'off'
  }
  const home = ensureSystemGroupRow(draft, homeGroupFor(targetType))
  return draftInsert(draft, {
    nodeType: 'ITEM',
    parentId: home.id,
    sortOrder: appendKeys(draft, home.id, 1)[0]!,
    targetType,
    targetIds: { [idKey]: parsed.key },
    isHidden,
  })
}

function ensureSystemGroupRow(
  draft: LayoutDraft,
  systemKey: SidebarSystemGroupKey
): SidebarNodeEntity {
  return (
    draftSystemGroup(draft, systemKey) ??
    draftInsert(draft, {
      nodeType: 'GROUP',
      parentId: null,
      sortOrder: appendKeys(draft, null, 1)[0]!,
      title: SIDEBAR_SYSTEM_GROUP_TITLES[systemKey],
      systemKey,
    })
  )
}

function requireRef(
  draft: LayoutDraft,
  env: LayoutEnv,
  keyMap: KeyMap,
  ref: string,
  label: string
): Result<SidebarNodeEntity, Error> {
  const row = resolveRef(draft, env, keyMap, ref)
  return row ? ok(row) : err(new NotFoundError(`${label} not found`))
}

/** True when every ref is an existing row id — the favorites-only paths need that. */
function allRows(draft: LayoutDraft, refs: (string | null | undefined)[]): boolean {
  return refs.every((ref) => ref == null || draft.rows.has(ref))
}

/** A favorite item or a folder: on an un-customized member every folder is a favorites folder. */
function isFavoriteRow(row: SidebarNodeEntity | undefined): boolean {
  return !!row && (row.nodeType === 'FOLDER' || isFavoriteItem(row))
}

/**
 * The favorites-only fast path (§4: pure favorite ops don't materialize): an un-customized
 * member acting on existing favorite rows inside Favorites, where the virtual Favorites
 * group is `parentId = null`.
 */
function isFavoritesOnly(
  draft: LayoutDraft,
  nodeRef: string | null,
  parentRef: string | null,
  neighbours: (string | null | undefined)[]
): boolean {
  if (isDraftCustomized(draft)) return false
  if (nodeRef !== null && !isFavoriteRow(draft.rows.get(nodeRef))) return false
  if (!allRows(draft, neighbours)) return false
  if (parentRef === FAVORITES_GROUP_REF) return true
  return parentRef !== null && draft.rows.get(parentRef)?.nodeType === 'FOLDER'
}

/** Siblings under `parentId` plus the neighbour rows, validated to belong there. */
function placement(
  draft: LayoutDraft,
  env: LayoutEnv,
  keyMap: KeyMap,
  parentId: string | null,
  excludeId: string | null,
  beforeRef?: string | null,
  afterRef?: string | null
): Result<string, Error> {
  const siblings = draftChildren(draft, parentId).filter((r) => r.id !== excludeId)
  const neighbour = (ref: string | null | undefined): Result<SidebarNodeEntity | null, Error> => {
    if (!ref) return ok(null)
    const row = resolveRef(draft, env, keyMap, ref)
    if (!row || !siblings.some((s) => s.id === row.id)) {
      return err(new BadRequestError('Drop neighbour is not a sibling at the target position'))
    }
    return ok(row)
  }
  const before = neighbour(beforeRef)
  if (before.isErr()) return err(before.error)
  const after = neighbour(afterRef)
  if (after.isErr()) return err(after.error)
  return ok(keyBetweenNeighbors(siblings, before.value, after.value))
}

export interface MoveNodeInput {
  nodeId: string
  /** Target parent ref; null only for GROUP moves. */
  parentId: string | null
  /** Sibling that ends up directly above the node. */
  beforeId?: string | null
  /** Sibling that ends up directly below the node. */
  afterId?: string | null
}

/** Move one node; without materialization this writes exactly one row. */
export function planMoveNode(draft: LayoutDraft, env: LayoutEnv, input: MoveNodeInput): PlanResult {
  const favoritesOnly = isFavoritesOnly(draft, input.nodeId, input.parentId, [
    input.beforeId,
    input.afterId,
  ])
  const keyMap = favoritesOnly ? new Map<string, string>() : materializeDraft(draft, env)

  const node = requireRef(draft, env, keyMap, input.nodeId, 'Sidebar node')
  if (node.isErr()) return err(node.error)

  let parent: { id: string | null; nodeType: 'GROUP' | 'FOLDER' } | null = null
  if (favoritesOnly && input.parentId === FAVORITES_GROUP_REF) {
    parent = { id: null, nodeType: 'GROUP' }
  } else if (input.parentId !== null) {
    const row = requireRef(draft, env, keyMap, input.parentId, 'Target parent')
    if (row.isErr()) return err(row.error)
    if (row.value.nodeType === 'ITEM') return err(new BadRequestError('Items cannot contain nodes'))
    parent = { id: row.value.id, nodeType: row.value.nodeType }
  }

  const depthError = checkDepth(node.value, parent)
  if (depthError) return err(depthError)
  const inFavorites = input.parentId === FAVORITES_GROUP_REF || isInFavorites(draft, parent?.id)
  if (inFavorites && !holdsOnlyFavorites(draft, node.value)) {
    return err(new BadRequestError('Only favorites can go in Favorites'))
  }

  const parentId = parent?.id ?? null
  const key = placement(draft, env, keyMap, parentId, node.value.id, input.beforeId, input.afterId)
  if (key.isErr()) return err(key.error)

  draftUpdate(draft, node.value.id, { parentId, sortOrder: key.value })
  return ok(node.value.id)
}

/** The Favorites group itself or a folder directly inside it. */
function isInFavorites(draft: LayoutDraft, parentId: string | null | undefined): boolean {
  const parent = parentId ? draft.rows.get(parentId) : undefined
  if (!parent) return false
  if (parent.nodeType === 'GROUP') return parent.systemKey === 'favorites'
  const group = parent.parentId ? draft.rows.get(parent.parentId) : undefined
  return group?.nodeType === 'GROUP' && group.systemKey === 'favorites'
}

/** A favorite item, or a folder whose children are all favorite items. */
function holdsOnlyFavorites(draft: LayoutDraft, node: SidebarNodeEntity): boolean {
  if (node.nodeType === 'FOLDER') return draftChildren(draft, node.id).every(isFavoriteItem)
  return isFavoriteItem(node)
}

function checkDepth(
  node: SidebarNodeEntity,
  parent: { id: string | null; nodeType: 'GROUP' | 'FOLDER' } | null
): BadRequestError | null {
  if (parent?.id != null && parent.id === node.id) {
    return new BadRequestError('A node cannot be its own parent')
  }
  if (node.nodeType === 'GROUP') {
    return parent ? new BadRequestError('Groups only reorder among groups') : null
  }
  if (!parent) return new BadRequestError('Only groups can sit at the top level')
  if (node.nodeType === 'FOLDER' && parent.nodeType !== 'GROUP') {
    return new BadRequestError('Folders cannot be nested')
  }
  return null
}

/** Hide or unhide any node; hiding a group or folder hides its subtree at render. */
export function planSetHidden(
  draft: LayoutDraft,
  env: LayoutEnv,
  input: { nodeId: string; isHidden: boolean }
): PlanResult {
  const keyMap = materializeDraft(draft, env)
  const node = requireRef(draft, env, keyMap, input.nodeId, 'Sidebar node')
  if (node.isErr()) return err(node.error)
  if (node.value.isHidden !== input.isHidden) {
    draftUpdate(draft, node.value.id, { isHidden: input.isHidden })
  }
  return ok(node.value.id)
}

export function planCreateGroup(
  draft: LayoutDraft,
  env: LayoutEnv,
  input: { title: string; beforeId?: string | null; afterId?: string | null }
): PlanResult {
  const title = input.title.trim()
  if (!title) return err(new BadRequestError('Group title is required'))
  const keyMap = materializeDraft(draft, env)
  const key = placement(draft, env, keyMap, null, null, input.beforeId, input.afterId)
  if (key.isErr()) return err(key.error)
  const row = draftInsert(draft, { nodeType: 'GROUP', parentId: null, sortOrder: key.value, title })
  return ok(row.id)
}

/** Create a folder in a group. Folders count against `FAVORITES_CAP`. */
export function planCreateFolder(
  draft: LayoutDraft,
  env: LayoutEnv,
  input: { parentId: string; title: string; beforeId?: string | null; afterId?: string | null }
): PlanResult {
  const title = input.title.trim()
  if (!title) return err(new BadRequestError('Folder title is required'))
  if (countFavoriteBudget([...draft.rows.values()]) >= FAVORITES_CAP) {
    return err(new BadRequestError(`Favorites cap reached (${FAVORITES_CAP})`))
  }

  const favoritesOnly =
    input.parentId === FAVORITES_GROUP_REF &&
    isFavoritesOnly(draft, null, input.parentId, [input.beforeId, input.afterId])
  const keyMap = favoritesOnly ? new Map<string, string>() : materializeDraft(draft, env)

  let parentId: string | null = null
  if (!favoritesOnly) {
    const parent = requireRef(draft, env, keyMap, input.parentId, 'Target group')
    if (parent.isErr()) return err(parent.error)
    if (parent.value.nodeType !== 'GROUP') {
      return err(new BadRequestError('Folders can only be created in a group'))
    }
    parentId = parent.value.id
  }

  const key = placement(draft, env, keyMap, parentId, null, input.beforeId, input.afterId)
  if (key.isErr()) return err(key.error)
  const row = draftInsert(draft, { nodeType: 'FOLDER', parentId, sortOrder: key.value, title })
  return ok(row.id)
}

/** Rename a group or folder. System groups can be renamed. */
export function planRenameNode(
  draft: LayoutDraft,
  env: LayoutEnv,
  input: { nodeId: string; title: string }
): PlanResult {
  const title = input.title.trim()
  if (!title) return err(new BadRequestError('Title is required'))
  const favoritesOnly =
    !isDraftCustomized(draft) && draft.rows.get(input.nodeId)?.nodeType === 'FOLDER'
  const keyMap = favoritesOnly ? new Map<string, string>() : materializeDraft(draft, env)
  const node = requireRef(draft, env, keyMap, input.nodeId, 'Sidebar node')
  if (node.isErr()) return err(node.error)
  if (node.value.nodeType === 'ITEM') return err(new BadRequestError('Items cannot be renamed'))
  draftUpdate(draft, node.value.id, { title })
  return ok(node.value.id)
}

/**
 * Delete a node without deleting what it holds (§5): a folder's items move to the
 * folder's group; a custom group's items go home by type (NAV → Workspace,
 * ENTITY_DEFINITION → Records, favorites → Favorites) and its folders are dissolved.
 */
export function planDeleteNode(
  draft: LayoutDraft,
  env: LayoutEnv,
  input: { nodeId: string }
): PlanResult {
  const favoritesOnly = !isDraftCustomized(draft) && isFavoriteRow(draft.rows.get(input.nodeId))
  const keyMap = favoritesOnly ? new Map<string, string>() : materializeDraft(draft, env)
  const found = requireRef(draft, env, keyMap, input.nodeId, 'Sidebar node')
  if (found.isErr()) return err(found.error)
  const node = found.value

  if (node.nodeType === 'ITEM') {
    if (!isFavoriteItem(node)) {
      return err(new BadRequestError('Nav and record items cannot be deleted; hide them instead'))
    }
    draftDelete(draft, node.id)
    return ok(null)
  }

  if (node.nodeType === 'FOLDER') {
    const items = draftChildren(draft, node.id)
    const keys = appendKeys(draft, node.parentId, items.length, node.id)
    items.forEach((item, i) => {
      draftUpdate(draft, item.id, { parentId: node.parentId, sortOrder: keys[i]! })
    })
    draftDelete(draft, node.id)
    return ok(null)
  }

  if (node.systemKey) {
    return err(new BadRequestError("System groups can't be deleted; hide the group instead"))
  }
  const toRehome: SidebarNodeEntity[] = []
  const folders: SidebarNodeEntity[] = []
  for (const child of draftChildren(draft, node.id)) {
    if (child.nodeType === 'FOLDER') {
      folders.push(child)
      toRehome.push(...draftChildren(draft, child.id))
    } else {
      toRehome.push(child)
    }
  }
  rehomeByType(draft, toRehome)
  for (const folder of folders) draftDelete(draft, folder.id)
  draftDelete(draft, node.id)
  return ok(null)
}

/** Append items to their system home group, preserving their relative order. */
function rehomeByType(draft: LayoutDraft, items: SidebarNodeEntity[]): void {
  const byHome = new Map<SidebarSystemGroupKey, SidebarNodeEntity[]>()
  for (const item of items) {
    const home = homeGroupFor(item.targetType)
    byHome.set(home, [...(byHome.get(home) ?? []), item])
  }
  for (const [home, list] of byHome) {
    const group = ensureSystemGroupRow(draft, home)
    const keys = appendKeys(draft, group.id, list.length)
    list.forEach((item, i) => {
      draftUpdate(draft, item.id, { parentId: group.id, sortOrder: keys[i]! })
    })
  }
}

/**
 * Back to the org default (§4): drop groups, NAV / ENTITY_DEFINITION items and folders
 * that hold no favorites; favorites and their folders return to the root in display order.
 */
export function planResetLayout(draft: LayoutDraft, env: LayoutEnv): PlanResult {
  const rows = [...draft.rows.values()]
  const favoritesGroupId = draftSystemGroup(draft, 'favorites')?.id ?? null
  const keptFolders = new Set(
    rows
      .filter(
        (f) =>
          f.nodeType === 'FOLDER' &&
          (f.parentId === null ||
            f.parentId === favoritesGroupId ||
            rows.some((r) => r.parentId === f.id && isFavoriteItem(r)))
      )
      .map((f) => f.id)
  )

  // Display order decides the new root order.
  const layout = resolveSidebarLayout({
    nodes: rows,
    snapshot: env.snapshot,
    resources: env.resources,
    navIds: env.navIds,
  })
  const rootOrder: string[] = []
  for (const group of layout.groups) {
    for (const child of group.children) {
      if (!child.nodeId) continue
      if (child.kind === 'FOLDER') {
        if (keptFolders.has(child.nodeId)) rootOrder.push(child.nodeId)
        else
          for (const item of child.children)
            if (item.nodeId && isFavoriteItem({ nodeType: 'ITEM', targetType: item.targetType }))
              rootOrder.push(item.nodeId)
      } else if (isFavoriteItem({ nodeType: 'ITEM', targetType: child.targetType })) {
        rootOrder.push(child.nodeId)
      }
    }
  }

  const keys = generateNKeysBetween(null, null, rootOrder.length)
  rootOrder.forEach((id, i) => {
    const row = draft.rows.get(id)!
    if (row.parentId !== null || row.sortOrder !== keys[i]) {
      draftUpdate(draft, id, { parentId: null, sortOrder: keys[i]! })
    }
  })

  const drop = (predicate: (r: SidebarNodeEntity) => boolean) => {
    for (const row of [...draft.rows.values()]) if (predicate(row)) draftDelete(draft, row.id)
  }
  drop((r) => r.nodeType === 'ITEM' && !isFavoriteItem(r))
  drop((r) => r.nodeType === 'FOLDER' && !keptFolders.has(r.id))
  drop((r) => r.nodeType === 'GROUP')
  return ok(null)
}
