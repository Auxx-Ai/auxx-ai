// apps/web/src/components/records/layout-editor/editor-state.ts

import type {
  CreatedBlock,
  RecordLayoutDelta,
  ResolvedLayout,
  ResolvedLayoutTab,
} from '@auxx/lib/record-layout/client'
import { resolveRecordLayout } from '@auxx/lib/record-layout/client'
import type { LayoutBlock } from '@auxx/lib/resources/client'

/**
 * The layout editor's working state and the two pure functions that bracket it
 * (`plans/drawer/record-layout-system.md` §9).
 *
 * The editor never edits a `RecordLayoutDelta` directly. It seeds a full working
 * model from the registry default plus the stored deltas, mutates that, and
 * DIFFS it back against the registry on save. That direction is what keeps the
 * write sparse: a delta produced here can only ever mention a key whose staged
 * value differs from what the registry would have produced, so an untouched
 * default is never written down and never frozen (§5, and
 * `plans/view-config/layered-view-config.md` §2.1).
 *
 * Deliberately free of React and of anything that touches the network, so the
 * whole edit model is unit-testable without a render.
 */

/** A tab in the editor's working model. */
export interface EditorTab {
  id: string
  label: string
  /** Icon name resolved through the union lookup in `~/components/records/layout/layout-icon`. */
  icon?: string
  /** Hard-coded content (Timeline, Comments, Tasks). Accepts no sections. */
  isBaseTab: boolean
  /** False for Overview, so the strip can never empty out. */
  hideable: boolean
  /** Mounts a lazily loaded component of its own on top of any blocks. */
  hasOwnComponent: boolean
  /** Created by an admin, so it lives in the delta's `tabs.added`. */
  isCreated: boolean
  /** Where an EMPTY created tab renders: immediately before this tab. */
  anchorTabId?: string
}

/**
 * Everything the editor stages, in one plain object.
 *
 * Two invariants the reducers in `./editor-actions` maintain and the tree
 * builder relies on:
 *
 * 1. `blockOrder` is grouped by `tabOrder`: every tab's blocks are contiguous
 * and the runs appear in tab order. That contiguity is what lets a drop
 * position identify its target tab, which is the whole reason the stored
 * `blockOrder` is one flat array rather than a list per tab.
 * 2. `tabOfBlock` names a tab that exists in `tabs`, and never a base tab.
 */
export interface LayoutEditorState {
  /** Tab ids in display order, hidden ones included. */
  tabOrder: string[]
  /** Explicitly hidden tab ids. */
  hiddenTabs: string[]
  tabs: Record<string, EditorTab>
  /** Flat block order with each tab's run contiguous, hidden blocks included. */
  blockOrder: string[]
  /** Which tab each block sits on. */
  tabOfBlock: Record<string, string>
  /** Explicitly hidden block ids. Listed by the editor, dropped by the renderer. */
  hiddenBlocks: string[]
  /** Admin-created blocks by generated id, i.e. the delta's `created`. */
  created: Record<string, CreatedBlock>
  /** Every block the editor can list, registry and created alike, by id. */
  blocks: Record<string, LayoutBlock>
}

/** Strip every `hidden` flag from a delta's block entries. */
function withoutBlockHiding(delta: RecordLayoutDelta | null | undefined): RecordLayoutDelta | null {
  if (!delta?.blocks) return delta ?? null
  const blocks: RecordLayoutDelta['blocks'] = {}
  for (const [id, entry] of Object.entries(delta.blocks)) {
    const { hidden: _hidden, ...rest } = entry
    blocks[id] = rest
  }
  return { ...delta, blocks }
}

/** Hidden block ids across both stored layers. */
function hiddenBlockIdsOf(
  orgDelta: RecordLayoutDelta | null | undefined,
  userDelta: RecordLayoutDelta | null | undefined
): Set<string> {
  const hidden = new Set<string>()
  for (const delta of [orgDelta, userDelta]) {
    for (const [id, entry] of Object.entries(delta?.blocks ?? {})) {
      if (entry.hidden === true) hidden.add(id)
    }
  }
  return hidden
}

function toEditorTab(tab: ResolvedLayoutTab, anchorTabId?: string): EditorTab {
  return {
    id: tab.id,
    label: tab.label,
    icon: tab.icon,
    isBaseTab: tab.isBaseTab,
    hideable: tab.hideable,
    hasOwnComponent: tab.hasOwnComponent,
    isCreated: tab.isCreated,
    anchorTabId,
  }
}

export interface SeedEditorStateParams {
  /** The registry default layer, from `buildRegistryLayout`. */
  registry: ResolvedLayout
  /** The org override as currently stored. */
  orgDelta?: RecordLayoutDelta | null
  /** The viewer's personal override as currently stored. */
  userDelta?: RecordLayoutDelta | null
}

/**
 * Build the editor's working model from the registry default and the two
 * stored deltas.
 *
 * The layout is resolved with every block-level `hidden` flag stripped, because
 * `resolveRecordLayout` drops a hidden block from its output entirely and the
 * editor has to keep listing it: a hidden block the tree could not show is one
 * an admin can never un-hide. Stripping the flag and recording it separately
 * reuses the real resolver as the single placement authority instead of
 * reimplementing it here with one rule changed.
 *
 * Permission-hidden blocks are a different thing and are NOT filtered anywhere
 * in this module: they stay listed (greyed and undraggable in the tree, §9.3) so
 * they cannot be silently dropped on save.
 */
export function seedEditorState(params: SeedEditorStateParams): LayoutEditorState {
  const { registry, orgDelta, userDelta } = params

  const resolved = resolveRecordLayout({
    registry,
    orgDelta: withoutBlockHiding(orgDelta),
    userDelta: withoutBlockHiding(userDelta),
  })

  const anchors = new Map<string, string | undefined>()
  for (const added of [...(orgDelta?.tabs?.added ?? []), ...(userDelta?.tabs?.added ?? [])]) {
    if (!anchors.has(added.id)) anchors.set(added.id, added.anchorTabId)
  }

  const tabs: Record<string, EditorTab> = {}
  const tabOrder: string[] = []
  const hiddenTabs: string[] = []
  const blockOrder: string[] = []
  const tabOfBlock: Record<string, string> = {}

  for (const tab of resolved.tabs) {
    tabs[tab.id] = toEditorTab(tab, anchors.get(tab.id))
    tabOrder.push(tab.id)
    if (tab.hidden) hiddenTabs.push(tab.id)
    for (const block of tab.blocks) {
      blockOrder.push(block.id)
      tabOfBlock[block.id] = tab.id
    }
  }

  const stored = hiddenBlockIdsOf(orgDelta, userDelta)
  const hiddenBlocks = blockOrder.filter((id) => stored.has(id))

  const created: Record<string, CreatedBlock> = {}
  for (const delta of [orgDelta, userDelta]) {
    for (const [id, entry] of Object.entries(delta?.created ?? {})) {
      // A created entry that no longer resolves (its target definition is gone)
      // is deliberately kept: dropping it here would delete the admin's section
      // on the next save just because it is temporarily unreadable (§6).
      if (!created[id]) created[id] = entry
    }
  }

  return {
    tabOrder,
    hiddenTabs,
    tabs,
    blockOrder,
    tabOfBlock,
    hiddenBlocks,
    created,
    blocks: { ...resolved.blocksById },
  }
}

/** Re-group `blockOrder` so every tab's run is contiguous and in tab order. */
export function normalizeBlockOrder(state: LayoutEditorState): string[] {
  const rank = new Map(state.tabOrder.map((tabId, index) => [tabId, index]))
  return state.blockOrder
    .map((blockId, index) => ({ blockId, index, tab: rank.get(state.tabOfBlock[blockId] ?? '') }))
    .filter((entry) => entry.tab !== undefined)
    .sort((a, b) => (a.tab as number) - (b.tab as number) || a.index - b.index)
    .map((entry) => entry.blockId)
}

/** The block ids on one tab, in render order. */
export function blocksOfTab(state: LayoutEditorState, tabId: string): string[] {
  return state.blockOrder.filter((blockId) => state.tabOfBlock[blockId] === tabId)
}

/** Tabs that are neither hidden nor rendered empty by hiding every section. */
export function visibleTabCount(state: LayoutEditorState): number {
  const hidden = new Set(state.hiddenTabs)
  return state.tabOrder.filter((tabId) => !hidden.has(tabId)).length
}
