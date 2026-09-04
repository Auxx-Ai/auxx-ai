// apps/web/src/components/records/layout-editor/editor-tree.ts

import type { LayoutBlock } from '@auxx/lib/resources/client'
import type { GroupedDragListGroup } from '~/components/grouped-drag-list/grouped-drag-list'
import type { EditorTab, LayoutEditorState } from './editor-state'
import { blocksOfTab } from './editor-state'

/**
 * The render model the editor hands to `GroupedDragList`
 * (`plans/drawer/record-layout-system.md` §9.3).
 *
 * Built from the REGISTRY plus the stored layout, never from what rendered.
 * Sections auto-hide when they resolve to nothing and the dialog is opened from
 * one record while the layout is per-definition, so a DOM-derived tree would
 * silently omit blocks that exist for every other record. Every placed block is
 * listed here regardless of what it would render; the ones that would come out
 * empty for the record in hand are MARKED, not dropped.
 */

/** Why a row cannot be moved or is not going to render. */
export interface LayoutRowStatus {
  /**
   * The viewer lacks this block's `permissionKey` / `recordResource` /
   * `featureGate`. Rendered greyed and undraggable rather than hidden, so an
   * admin cannot silently drop a block they cannot see (§9.3).
   */
  restricted: boolean
  /** An explicit admin hide, i.e. `blocks[id].hidden` in the stored delta. */
  hidden: boolean
  /** Would render nothing for the record the dialog was opened from. */
  emptyHere: boolean
}

/**
 * One row in the editor tree: always a placed block.
 *
 * Base tabs contribute none. They render hard-coded content and accept no
 * sections, so a child row under them could only be a placeholder, and a
 * placeholder in a tree of movable sections reads as one more movable section.
 */
export interface LayoutEditorRow {
  id: string
  block: LayoutBlock
  /** Created by an admin, so it can be deleted rather than only hidden. */
  isCreated: boolean
  status: LayoutRowStatus
}

/** A tab in the drag list's vocabulary, carrying the editor's own tab with it. */
export interface LayoutEditorGroup extends GroupedDragListGroup {
  tab: EditorTab
  /** True when every one of the tab's sections is hidden. */
  allSectionsHidden: boolean
}

export interface BuildEditorTreeParams {
  state: LayoutEditorState
  /** Whether the viewer may see a block, i.e. all of its registry gates pass. */
  isBlockVisible: (block: LayoutBlock) => boolean
  /** Whether a block resolves to nothing for the record the dialog opened from. */
  isBlockEmptyHere?: (block: LayoutBlock) => boolean
}

export interface EditorTree {
  rows: LayoutEditorRow[]
  groups: LayoutEditorGroup[]
}

/**
 * Build the flat row list and the tab groups for one staged state.
 *
 * Two structural decisions live here:
 *
 * 1. **Rows come out in `blockOrder`, which the reducers keep grouped by
 * `tabOrder`.** `GroupedDragList` derives a group's position from where its
 * first member sits in the flat order, so the two arrays have to agree or the
 * strip in the dialog would not match the strip in the drawer.
 * 2. **A base tab contributes no rows.** Timeline, Comments and Tasks render
 * hard-coded content and accept no sections, so there is nothing truthful to
 * list under them: a placeholder child ("Activity timeline") reads as a section
 * the admin could move or hide, and none of that is true. They stay reorderable
 * and hideable as bare rows.
 */
export function buildEditorTree(params: BuildEditorTreeParams): EditorTree {
  const { state, isBlockVisible, isBlockEmptyHere } = params
  const hidden = new Set(state.hiddenBlocks)

  const rows: LayoutEditorRow[] = []
  const groups: LayoutEditorGroup[] = []

  for (const tabId of state.tabOrder) {
    const tab = state.tabs[tabId]
    if (!tab) continue

    const itemIds: string[] = []

    if (!tab.isBaseTab) {
      for (const blockId of blocksOfTab(state, tabId)) {
        const block = state.blocks[blockId]
        if (!block) continue
        rows.push({
          id: blockId,
          block,
          isCreated: state.created[blockId] !== undefined,
          status: {
            restricted: !isBlockVisible(block),
            hidden: hidden.has(blockId),
            emptyHere: isBlockEmptyHere?.(block) ?? false,
          },
        })
        itemIds.push(blockId)
      }
    }

    groups.push({
      id: tabId,
      itemIds,
      tab,
      allSectionsHidden:
        !tab.isBaseTab && itemIds.length > 0 && itemIds.every((id) => hidden.has(id)),
    })
  }

  // An empty tab has no member to derive a position from, so it records the row
  // it renders before, the same trick `anchorFieldId` plays for an empty field
  // group, and the reason `groupItemOrder` accepts an anchor at all.
  const firstRowOfGroup = new Map<string, string>()
  for (const group of groups) {
    const first = group.itemIds[0]
    if (first !== undefined) firstRowOfGroup.set(group.id, first)
  }
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index] as LayoutEditorGroup
    if (group.itemIds.length > 0) continue
    for (let next = index + 1; next < groups.length; next++) {
      const anchor = firstRowOfGroup.get((groups[next] as LayoutEditorGroup).id)
      if (anchor !== undefined) {
        group.anchorItemId = anchor
        break
      }
    }
  }

  return { rows, groups }
}

/**
 * The predefined blocks the "Add section" popover may offer for a tab (§9.4).
 *
 * "Not currently placed" is read as "not rendering anywhere", which covers two
 * cases: a catalog block the stored layout never placed, and one an admin hid.
 * The registry places every block it knows about, so in practice the hidden set
 * is what this list is for: re-adding a hidden section is how it comes back,
 * and that is exactly why a hidden block is never deleted from the delta.
 */
export function addableBlocks(
  state: LayoutEditorState,
  catalog: Record<string, LayoutBlock>
): LayoutBlock[] {
  const hidden = new Set(state.hiddenBlocks)
  return Object.values(catalog).filter(
    (block) => state.tabOfBlock[block.id] === undefined || hidden.has(block.id)
  )
}

/**
 * What a tab row says it holds.
 *
 * A bare section count lies about a tab that mounts a component of its own.
 * Company > Parts owns the whole parts table and holds no blocks, so "0" read
 * as "this tab is empty" when it was the fullest tab in the drawer. Built-in
 * content is not a section, cannot be moved or hidden, and so is named rather
 * than counted.
 */
export function tabContentSummary(
  tab: Pick<EditorTab, 'isBaseTab' | 'hasOwnComponent'>,
  sectionCount: number
): string {
  if (!tab.isBaseTab && !tab.hasOwnComponent) return `${sectionCount}`
  return sectionCount > 0 ? `built in + ${sectionCount}` : 'built in'
}
