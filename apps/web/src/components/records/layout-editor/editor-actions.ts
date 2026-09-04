// apps/web/src/components/records/layout-editor/editor-actions.ts

import type { CreatedBlock } from '@auxx/lib/record-layout/client'
import type { LayoutBlock } from '@auxx/lib/resources/client'
import { parseGroupDropId } from '~/components/grouped-drag-list/drop-targets'
import {
  blocksOfTab,
  type EditorTab,
  type LayoutEditorState,
  normalizeBlockOrder,
  visibleTabCount,
} from './editor-state'

/**
 * Every mutation the layout editor can stage, as pure state transitions
 * (`plans/drawer/record-layout-system.md` §9.2 / §9.3).
 *
 * All of them return the input state BY REFERENCE when the edit is a no-op or
 * is refused, so the caller can write the result back unconditionally and React
 * still skips the render. Refusals are silent on purpose: a base tab rejecting a
 * section drop is a drag that lands nowhere, not an error toast.
 */

/**
 * The tab a dnd id addresses: a group header, or a block.
 *
 * Returns null when the id names nothing the editor knows, which every caller
 * treats as "refuse the drop" rather than guessing a tab.
 */
export function tabOfDropId(state: LayoutEditorState, dropId: string): string | null {
  const groupId = parseGroupDropId(dropId)
  if (groupId !== null) return state.tabs[groupId] ? groupId : null
  return state.tabOfBlock[dropId] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKS
// ─────────────────────────────────────────────────────────────────────────────

export interface MoveBlockParams {
  /** The block in hand. */
  blockId: string
  /** Drop target: a block id, or `group:<tabId>`. */
  overId: string
  /** Which side of an item target the block lands on. */
  edge?: 'before' | 'after'
}

/**
 * Move a block to another slot, changing its tab when the drop lands on one.
 *
 * Refused outright when the target tab is a base tab: those render hard-coded
 * content and accept no sections. The refusal lives here rather than in the drag
 * component because it is a fact about the layout model, not about the gesture
 * the same rule has to hold for the "Add section" popover, which never produces
 * a drag at all.
 */
export function moveBlock(state: LayoutEditorState, params: MoveBlockParams): LayoutEditorState {
  const { blockId, overId, edge } = params
  if (!state.blocks[blockId] || state.tabOfBlock[blockId] === undefined) return state

  const targetTabId = tabOfDropId(state, overId)
  if (targetTabId === null) return state
  const targetTab = state.tabs[targetTabId]
  if (!targetTab || targetTab.isBaseTab) return state

  const reduced = state.blockOrder.filter((id) => id !== blockId)

  const insertIndex = (() => {
    const overTabId = parseGroupDropId(overId)
    // Dropped on the header: land at the HEAD of that tab's run, which is where
    // `GroupedDragList` draws the insert line for a `group-into` target.
    if (overTabId !== null) return startOfTabRun(state, reduced, overTabId)
    const at = reduced.indexOf(overId)
    if (at === -1) return startOfTabRun(state, reduced, targetTabId)
    return edge === 'after' ? at + 1 : at
  })()

  const nextOrder = [...reduced]
  nextOrder.splice(insertIndex, 0, blockId)

  const next: LayoutEditorState = {
    ...state,
    blockOrder: nextOrder,
    tabOfBlock: { ...state.tabOfBlock, [blockId]: targetTabId },
  }
  const normalized = normalizeBlockOrder(next)
  if (
    targetTabId === state.tabOfBlock[blockId] &&
    normalized.join(' ') === state.blockOrder.join(' ')
  ) {
    return state
  }
  return { ...next, blockOrder: normalized }
}

/**
 * Where a tab's run starts in an order that may not contain any of its members:
 * the first block belonging to a LATER tab, or the end of the list.
 */
function startOfTabRun(state: LayoutEditorState, order: string[], tabId: string): number {
  const rank = state.tabOrder.indexOf(tabId)
  if (rank === -1) return order.length
  for (let i = 0; i < order.length; i++) {
    const memberTab = state.tabOfBlock[order[i] as string]
    const memberRank = memberTab === undefined ? -1 : state.tabOrder.indexOf(memberTab)
    if (memberRank >= rank) return i
  }
  return order.length
}

/**
 * Hide or show a block.
 *
 * A tab whose sections are ALL hidden is an empty tab, which §7's derived tab
 * visibility would then drop from the strip, so the last visible section of a
 * tab that has no component of its own locks on, exactly as the last visible tab
 * does one level up (§9.6).
 */
export function setBlockHidden(
  state: LayoutEditorState,
  blockId: string,
  hidden: boolean
): LayoutEditorState {
  const already = state.hiddenBlocks.includes(blockId)
  if (already === hidden) return state
  if (hidden && isLastVisibleBlockOfTab(state, blockId)) return state
  return {
    ...state,
    hiddenBlocks: hidden
      ? [...state.hiddenBlocks, blockId]
      : state.hiddenBlocks.filter((id) => id !== blockId),
  }
}

/**
 * Whether hiding this block would leave its tab with nothing to render.
 *
 * A tab that mounts a component of its own still renders without blocks, so the
 * lock only applies to a tab that IS its blocks.
 */
export function isLastVisibleBlockOfTab(state: LayoutEditorState, blockId: string): boolean {
  const tabId = state.tabOfBlock[blockId]
  if (!tabId) return false
  const tab = state.tabs[tabId]
  if (!tab || tab.isBaseTab || tab.hasOwnComponent) return false
  const hidden = new Set(state.hiddenBlocks)
  const visible = blocksOfTab(state, tabId).filter((id) => !hidden.has(id))
  return visible.length <= 1 && visible[0] === blockId
}

/** Place a predefined or newly created block at the end of a tab. */
export function addBlockToTab(
  state: LayoutEditorState,
  params: { block: LayoutBlock; tabId: string; created?: CreatedBlock }
): LayoutEditorState {
  const { block, tabId, created } = params
  const tab = state.tabs[tabId]
  if (!tab || tab.isBaseTab) return state
  if (state.tabOfBlock[block.id] !== undefined) return state

  const next: LayoutEditorState = {
    ...state,
    blocks: { ...state.blocks, [block.id]: block },
    blockOrder: [...state.blockOrder, block.id],
    tabOfBlock: { ...state.tabOfBlock, [block.id]: tabId },
    hiddenBlocks: state.hiddenBlocks.filter((id) => id !== block.id),
    created: created ? { ...state.created, [block.id]: created } : state.created,
  }
  return { ...next, blockOrder: normalizeBlockOrder(next) }
}

/**
 * Remove an admin-created block entirely.
 *
 * Only created blocks can be removed. A registry block has no "delete": the
 * stored layout governs placement and visibility only, so the way to take a
 * shipped section off a surface is to hide it, which survives a later registry
 * change (§6).
 */
export function deleteCreatedBlock(state: LayoutEditorState, blockId: string): LayoutEditorState {
  if (!state.created[blockId]) return state
  const { [blockId]: _created, ...created } = state.created
  const { [blockId]: _block, ...blocks } = state.blocks
  const { [blockId]: _tab, ...tabOfBlock } = state.tabOfBlock
  return {
    ...state,
    created,
    blocks,
    tabOfBlock,
    blockOrder: state.blockOrder.filter((id) => id !== blockId),
    hiddenBlocks: state.hiddenBlocks.filter((id) => id !== blockId),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move a whole tab, carrying its sections.
 *
 * Tab position is EXPLICIT here (`tabOrder`), unlike the field panel's groups,
 * whose position is derived from where their first member sits. That is why this
 * is a plain array move and not `moveGroupBlock`: the flat block order is
 * re-derived from `tabOrder` afterwards, so the two can never disagree.
 *
 * Direction follows the same rule the drag component's insert line draws:
 * dragging DOWN lands after the target, dragging UP lands at it.
 */
export function moveTab(
  state: LayoutEditorState,
  params: {
    tabId: string
    overId: string
    overIsGroup: boolean
    /**
     * Whether the actor may write the ORG layer.
     *
     * A created tab's default position for the whole org is its own
     * `anchorTabId`, which lives in the org delta, so re-pointing it on a drag
     * is an org-scope edit. For an ordinary member the anchor has to stay put:
     * the personal diff is taken against the org resolution, so moving the
     * anchor would make that resolution already agree with the staged order and
     * the drag would silently write nothing.
     */
    canAdministerDef?: boolean
  }
): LayoutEditorState {
  const { tabId, overId, overIsGroup, canAdministerDef = false } = params
  const targetTabId = overIsGroup ? overId : tabOfDropId(state, overId)
  if (targetTabId === null || targetTabId === tabId) return state

  const from = state.tabOrder.indexOf(tabId)
  const to = state.tabOrder.indexOf(targetTabId)
  if (from === -1 || to === -1) return state

  const tabOrder = [...state.tabOrder]
  tabOrder.splice(from, 1)
  const anchor = tabOrder.indexOf(targetTabId)
  tabOrder.splice(from < to ? anchor + 1 : anchor, 0, tabId)
  if (tabOrder.join(' ') === state.tabOrder.join(' ')) return state

  let tabs = state.tabs
  const moved = state.tabs[tabId]
  if (canAdministerDef && moved?.isCreated) {
    tabs = { ...tabs, [tabId]: { ...moved, anchorTabId: tabOrder[tabOrder.indexOf(tabId) + 1] } }
  }

  const next: LayoutEditorState = { ...state, tabOrder, tabs }
  return { ...next, blockOrder: normalizeBlockOrder(next) }
}

/**
 * Hide or show a tab.
 *
 * Overview is `hideable: false` and the last visible tab locks on, so the strip
 * can never empty out (§9.6).
 */
export function setTabHidden(
  state: LayoutEditorState,
  tabId: string,
  hidden: boolean
): LayoutEditorState {
  const tab = state.tabs[tabId]
  if (!tab) return state
  const already = state.hiddenTabs.includes(tabId)
  if (already === hidden) return state
  if (hidden && (!tab.hideable || visibleTabCount(state) <= 1)) return state
  return {
    ...state,
    hiddenTabs: hidden
      ? [...state.hiddenTabs, tabId]
      : state.hiddenTabs.filter((id) => id !== tabId),
  }
}

/** Whether this tab's visibility switch must stay locked on. */
export function isTabVisibilityLocked(state: LayoutEditorState, tabId: string): boolean {
  const tab = state.tabs[tabId]
  if (!tab) return true
  if (!tab.hideable) return true
  return !state.hiddenTabs.includes(tabId) && visibleTabCount(state) <= 1
}

/**
 * Append an admin-created tab.
 *
 * The tab records its own `anchorTabId` (the tab it renders before) because a
 * tab holding no block has nothing to derive a position from: the empty-tab
 * twin of `fieldGroupSchema.anchorFieldId`, and it exists for the identical
 * reason. The anchor is ignored the moment the tab holds a block.
 */
export function createTab(
  state: LayoutEditorState,
  params: { id: string; label: string; icon?: string; beforeTabId?: string }
): LayoutEditorState {
  const { id, label, icon, beforeTabId } = params
  if (state.tabs[id]) return state

  const anchorTabId = beforeTabId ?? firstBaseTabId(state)
  const tab: EditorTab = {
    id,
    label,
    icon,
    isBaseTab: false,
    hideable: true,
    hasOwnComponent: false,
    isCreated: true,
    anchorTabId,
  }

  const tabOrder = [...state.tabOrder]
  const at = anchorTabId ? tabOrder.indexOf(anchorTabId) : -1
  if (at === -1) tabOrder.push(id)
  else tabOrder.splice(at, 0, id)

  const next: LayoutEditorState = { ...state, tabOrder, tabs: { ...state.tabs, [id]: tab } }
  return { ...next, blockOrder: normalizeBlockOrder(next) }
}

/** The first base tab, i.e. where a new tab lands: after the entity tabs. */
function firstBaseTabId(state: LayoutEditorState): string | undefined {
  return state.tabOrder.find((tabId) => state.tabs[tabId]?.isBaseTab)
}

/** Rename or re-icon an admin-created tab. Registry tabs are code, not data. */
export function updateCreatedTab(
  state: LayoutEditorState,
  tabId: string,
  patch: { label?: string; icon?: string }
): LayoutEditorState {
  const tab = state.tabs[tabId]
  if (!tab?.isCreated) return state
  const nextTab: EditorTab = {
    ...tab,
    label: patch.label ?? tab.label,
    icon: patch.icon ?? tab.icon,
  }
  if (nextTab.label === tab.label && nextTab.icon === tab.icon) return state
  return { ...state, tabs: { ...state.tabs, [tabId]: nextTab } }
}

/**
 * Delete an admin-created tab. Its sections move to the first tab that accepts
 * them rather than disappearing, since a stored layout may never lose a block.
 */
export function deleteCreatedTab(state: LayoutEditorState, tabId: string): LayoutEditorState {
  const tab = state.tabs[tabId]
  if (!tab?.isCreated) return state

  const fallbackTabId = state.tabOrder.find(
    (candidate) => candidate !== tabId && state.tabs[candidate]?.isBaseTab === false
  )
  if (!fallbackTabId) return state

  const tabOfBlock = { ...state.tabOfBlock }
  for (const blockId of blocksOfTab(state, tabId)) tabOfBlock[blockId] = fallbackTabId

  const { [tabId]: _tab, ...tabs } = state.tabs
  const next: LayoutEditorState = {
    ...state,
    tabs,
    tabOfBlock,
    tabOrder: state.tabOrder.filter((id) => id !== tabId),
    hiddenTabs: state.hiddenTabs.filter((id) => id !== tabId),
  }
  return { ...next, blockOrder: normalizeBlockOrder(next) }
}
