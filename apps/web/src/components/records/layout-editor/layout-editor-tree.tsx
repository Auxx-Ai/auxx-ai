// apps/web/src/components/records/layout-editor/layout-editor-tree.tsx
'use client'

import type { LayoutBlock } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import {
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { GroupedDragList } from '~/components/grouped-drag-list/grouped-drag-list'
import { AddSectionMenu } from './add-section-popover'
import {
  isLastVisibleBlockOfTab,
  isTabVisibilityLocked,
  moveBlock,
  moveTab,
  setBlockHidden,
  setTabHidden,
} from './editor-actions'
import type { LayoutEditorState } from './editor-state'
import {
  addableBlocks,
  buildEditorTree,
  type LayoutEditorGroup,
  type LayoutEditorRow,
} from './editor-tree'
import { LayoutSectionRow } from './rows/layout-section-row'
import { LayoutTabRow } from './rows/layout-tab-row'

export interface LayoutEditorTreeProps {
  state: LayoutEditorState
  update: (reducer: (state: LayoutEditorState) => LayoutEditorState) => void
  /** Every predefined block for this definition, by id. */
  catalog: Record<string, LayoutBlock>
  /** Whether the viewer may see a block, i.e. all of its registry gates pass. */
  isBlockVisible: (block: LayoutBlock) => boolean
  /** Whether a block resolves to nothing for the record the dialog opened from. */
  isBlockEmptyHere?: (block: LayoutBlock) => boolean
  canAdministerDef: boolean
  /** The tab whose label should take focus (just created in this session). */
  newTabId: string | null
  onCreateTab: () => void
  onDeleteTab: (tabId: string) => void
  onRenameTab: (tabId: string, label: string) => void
  onChangeTabIcon: (tabId: string, icon: string) => void
  onAddBlock: (tabId: string, block: LayoutBlock) => void
  onDeleteBlock: (blockId: string) => void
  onCreateRecordsBlock: (tabId: string) => void
  onCreateFieldsBlock: (tabId: string) => void
}

/**
 * The editor's tree: a `TreeRow` per tab whose children are its sections, with
 * a "Create tab" button at the end (§9.1).
 *
 * The whole drag model comes from `GroupedDragList` rather than from
 * `SortableList`, because moving a section between tabs is a CROSS-PARENT drop
 * and the flat sortable primitive is documented not to do those. Tabs map to
 * groups and sections to items one for one, so the component needs no fork: the
 * only thing this file owns is what a row looks like and what a drop MEANS,
 * which is the layout model's business and not the drag component's.
 */
export function LayoutEditorTree({
  state,
  update,
  catalog,
  isBlockVisible,
  isBlockEmptyHere,
  canAdministerDef,
  newTabId,
  onCreateTab,
  onDeleteTab,
  onRenameTab,
  onChangeTabIcon,
  onAddBlock,
  onDeleteBlock,
  onCreateRecordsBlock,
  onCreateFieldsBlock,
}: LayoutEditorTreeProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  /** The tab whose "Add section" popover is open, if any. */
  const [addSectionTabId, setAddSectionTabId] = useState<string | null>(null)

  const { rows, groups } = useMemo(
    () => buildEditorTree({ state, isBlockVisible, isBlockEmptyHere }),
    [state, isBlockVisible, isBlockEmptyHere]
  )

  const available = useMemo(() => addableBlocks(state, catalog), [state, catalog])

  const hiddenTabs = new Set(state.hiddenTabs)

  /**
   * A section drop. `over` is a block id, a base tab's synthetic row id, or a
   * bare `group:<tabId>` when the drop landed on a tab header: the reducer
   * resolves all three, and refuses the ones a base tab would swallow.
   */
  const handleItemDragEnd = (event: DragEndEvent, edge?: 'before' | 'after') => {
    const { active, over } = event
    if (!over) return
    const blockId = String(active.id)
    update((prev) => moveBlock(prev, { blockId, overId: String(over.id), edge }))
  }

  const handleMoveGroup = (tabId: string, overId: string, overIsGroup: boolean) => {
    update((prev) => moveTab(prev, { tabId, overId, overIsGroup, canAdministerDef }))
  }

  return (
    <div className='flex flex-col gap-0'>
      <GroupedDragList<LayoutEditorRow, LayoutEditorGroup>
        rows={rows}
        rowId={(row) => row.id}
        rowKey={(row) => row.id}
        groups={groups}
        // The editor is always in edit mode: every tab is forced open, empty
        // tabs render as drop targets, and there is no collapse affordance to
        // confuse with the visibility switch.
        isEditMode
        sensors={sensors}
        onItemDragEnd={handleItemDragEnd}
        onMoveGroup={handleMoveGroup}
        // Deliberately NO `onPlaceItemBesideGroup`: every section belongs to a
        // tab, so "beside a tab, in no tab at all" is not a position this model
        // can express and the drop is a no-op rather than a silent loss.
        groupedRowClassName=''
        renderGroupHeader={(group, ctx) => (
          <LayoutTabRow
            tab={group.tab}
            sectionCount={group.itemIds.length}
            visible={!hiddenTabs.has(group.id)}
            locked={isTabVisibilityLocked(state, group.id)}
            canAdministerDef={canAdministerDef}
            preview={ctx.preview}
            autoFocusLabel={!ctx.preview && group.id === newTabId}
            addSectionOpen={!ctx.preview && addSectionTabId === group.id}
            onAddSectionOpenChange={(open) => setAddSectionTabId(open ? group.id : null)}
            addSectionMenu={
              <AddSectionMenu
                tabLabel={group.tab.label}
                blocks={available}
                onSelectBlock={(block) => {
                  onAddBlock(group.id, block)
                  setAddSectionTabId(null)
                }}
                onCreateRecordsBlock={() => {
                  setAddSectionTabId(null)
                  onCreateRecordsBlock(group.id)
                }}
                onCreateFieldsBlock={() => {
                  setAddSectionTabId(null)
                  onCreateFieldsBlock(group.id)
                }}
              />
            }
            onToggleVisible={() =>
              update((prev) => setTabHidden(prev, group.id, !prev.hiddenTabs.includes(group.id)))
            }
            onRename={(label) => onRenameTab(group.id, label)}
            onChangeIcon={(icon) => onChangeTabIcon(group.id, icon)}
            onDelete={() => onDeleteTab(group.id)}
          />
        )}
        renderRow={(row, ctx) => (
          <LayoutSectionRow
            row={row}
            canAdministerDef={canAdministerDef}
            locked={isLastVisibleBlockOfTab(state, row.id)}
            preview={ctx.preview}
            onToggleHidden={() =>
              update((prev) => setBlockHidden(prev, row.id, !prev.hiddenBlocks.includes(row.id)))
            }
            onDelete={() => onDeleteBlock(row.id)}
          />
        )}
      />

      {canAdministerDef && (
        <Button
          variant='ghost'
          size='sm'
          onClick={onCreateTab}
          className='mt-1 w-full justify-start text-muted-foreground'>
          <Plus />
          Create tab
        </Button>
      )}
    </div>
  )
}
