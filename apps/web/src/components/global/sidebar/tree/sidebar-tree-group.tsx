// apps/web/src/components/global/sidebar/tree/sidebar-tree-group.tsx
'use client'

import { SidebarGroup, SidebarGroupCollapse, SidebarMenu } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { FolderPlus } from 'lucide-react'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { useSidebarGroupOpen, useSidebarStateActions } from '~/hooks/use-sidebar-state'
import { SidebarGroupHeader } from '../sidebar-group-header'
import { SidebarNavItem } from '../sidebar-nav-item'
import { GroupMenuItems } from './group-menu-items'
import type { RenderGroup } from './sidebar-access'
import { type SidebarGroupTargetData, sidebarSortableId } from './sidebar-drop-rules'
import { SidebarFolder } from './sidebar-folder'
import { useSidebarTree } from './sidebar-tree-context'
import { SidebarTreeItem, UnhideButton } from './sidebar-tree-item'
import {
  SidebarCollapsedContext,
  useSidebarCanDropInto,
  useSidebarSortable,
} from './use-sidebar-sortable'

/** Collapse-state id of a group; system ids predate the unified tree so users keep their state. */
export function groupStateId(group: Pick<RenderGroup, 'key' | 'systemKey'>): string {
  if (group.systemKey === 'workspace') return 'configurations'
  if (group.systemKey) return group.systemKey
  return `group.${group.key}`
}

type Draft = 'rename' | 'folder' | 'group'

/** Inline title input used for rename and for drafting a new group or folder. */
function TitleDraft({
  initial,
  icon,
  onCommit,
  onCancel,
}: {
  initial: string
  icon?: ReactNode
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <SidebarNavItem
      id='__sidebar_draft__'
      name=''
      href='#'
      icon={icon}
      isEditing
      editValue={value}
      onEditChange={setValue}
      onEditCommit={() => (value.trim() ? onCommit(value.trim()) : onCancel())}
      onEditCancel={onCancel}
    />
  )
}

/**
 * A group section, sortable among groups: the section is the sortable node (its rows move with
 * it) and the header is the handle. The header is also a drop target that appends folders/items.
 */
export function SidebarTreeGroup({ group }: { group: RenderGroup }) {
  const { mutations } = useSidebarTree()
  const stateId = groupStateId(group)
  const isOpen = useSidebarGroupOpen(stateId)
  const { toggleGroup } = useSidebarStateActions()
  const [draft, setDraft] = useState<Draft | null>(null)
  const queuedDraft = useRef<Draft | null>(null)
  const childIds = group.children.map((c) => sidebarSortableId(c.key))

  const sortable = useSidebarSortable(
    { key: group.key, kind: 'GROUP', parentKey: null, label: group.title },
    draft === 'rename'
  )
  const acceptsInto = useSidebarCanDropInto(group.key)
  const dropTarget = useDroppable({
    id: `sidebar-group-${group.key}`,
    data: {
      type: 'sidebar-group-target',
      groupKey: group.key,
      open: isOpen,
    } satisfies SidebarGroupTargetData,
    disabled: !acceptsInto,
  })
  // Header only: the section's own isOver flips on every gap between rows and made the header flash.
  const isDropOver = acceptsInto && dropTarget.isOver
  const setHeaderRef = useCallback(
    (el: HTMLDivElement | null) => {
      sortable.setActivatorNodeRef(el)
      dropTarget.setNodeRef(el)
    },
    [sortable.setActivatorNodeRef, dropTarget.setNodeRef]
  )

  const closeDraft = () => setDraft(null)

  return (
    <>
      <SidebarGroup
        ref={sortable.setNodeRef}
        style={sortable.style}
        className={cn(
          'group',
          sortable.isDragging && 'opacity-40',
          group.ownHidden && 'opacity-50'
        )}>
        {draft === 'rename' ? (
          <TitleDraft
            initial={group.title}
            onCommit={(title) => {
              closeDraft()
              if (title !== group.title) void mutations.rename(group.key, title)
            }}
            onCancel={closeDraft}
          />
        ) : (
          <div
            ref={setHeaderRef}
            data-state={isOpen ? 'open' : 'closed'}
            {...sortable.attributes}
            {...sortable.listeners}
            className={cn(
              'relative rounded-md transition-colors duration-150',
              isDropOver && 'bg-primary/20 outline-primary/80 ring-2 ring-inset ring-primary/60'
            )}>
            <SidebarGroupHeader
              title={group.title}
              isEditMode={false}
              onToggleEditMode={() => {}}
              isOpen={isOpen}
              toggleOpen={() => toggleGroup(stateId)}
              hideEditOption
              onMenuClosed={() => {
                setDraft(queuedDraft.current)
                queuedDraft.current = null
              }}
              additionalOptions={
                <GroupMenuItems
                  group={group}
                  onRename={() => (queuedDraft.current = 'rename')}
                  onNewFolder={() => {
                    if (!isOpen) toggleGroup(stateId)
                    queuedDraft.current = 'folder'
                  }}
                  onNewGroup={() => (queuedDraft.current = 'group')}
                />
              }
            />
            {group.ownHidden && <UnhideButton nodeKey={group.key} />}
          </div>
        )}
        <SidebarGroupCollapse open={isOpen}>
          <SidebarCollapsedContext.Provider value={!isOpen}>
            <SidebarMenu className='gap-0'>
              <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
                {group.children.map((child) =>
                  child.kind === 'FOLDER' ? (
                    <SidebarFolder key={child.key} folder={child} />
                  ) : (
                    <SidebarTreeItem key={child.key} item={child} />
                  )
                )}
              </SortableContext>
              {draft === 'folder' && (
                <TitleDraft
                  initial=''
                  icon={<FolderPlus />}
                  onCommit={(title) => {
                    closeDraft()
                    void mutations.createFolder(group.key, title)
                  }}
                  onCancel={closeDraft}
                />
              )}
            </SidebarMenu>
          </SidebarCollapsedContext.Provider>
        </SidebarGroupCollapse>
      </SidebarGroup>
      {draft === 'group' && (
        <SidebarGroup>
          <TitleDraft
            initial=''
            onCommit={(title) => {
              closeDraft()
              void mutations.createGroup(title, { beforeId: group.key })
            }}
            onCancel={closeDraft}
          />
        </SidebarGroup>
      )}
    </>
  )
}
