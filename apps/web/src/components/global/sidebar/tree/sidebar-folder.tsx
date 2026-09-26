// apps/web/src/components/global/sidebar/tree/sidebar-folder.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { CollapsibleChevron } from '@auxx/ui/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  SidebarGroupCollapse,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Folder, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useContext, useState } from 'react'
import { useSidebarSectionOpen, useSidebarStateActions } from '~/hooks/use-sidebar-state'
import { LayoutMenuItems } from './layout-menu-items'
import type { RenderFolder } from './sidebar-access'
import { type SidebarFolderTargetData, sidebarSortableId } from './sidebar-drop-rules'
import { useSidebarTree } from './sidebar-tree-context'
import { SidebarTreeItem, UnhideButton } from './sidebar-tree-item'
import {
  SidebarCollapsedContext,
  useSidebarCanDropInto,
  useSidebarSortable,
} from './use-sidebar-sortable'

/** Collapse-state id of a folder. */
export function folderSectionId(key: string): string {
  return `folder.${key}`
}

/**
 * Folder row that is both sortable (among its group's rows) and a drop target (an item dropped
 * here moves into it). The whole row is the handle; PointerSensor's distance keeps clicks alive.
 */
export function SidebarFolder({ folder }: { folder: RenderFolder }) {
  const { mutations } = useSidebarTree()
  const sectionId = folderSectionId(folder.key)
  const { toggleSection } = useSidebarStateActions()
  const isOpen = useSidebarSectionOpen(sectionId, false)
  const parentCollapsed = useContext(SidebarCollapsedContext)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(folder.title)
  const childIds = folder.children.map((c) => sidebarSortableId(c.key))

  const sortable = useSidebarSortable(
    {
      key: folder.key,
      kind: 'FOLDER',
      parentKey: folder.parentKey,
      label: folder.title,
      open: isOpen,
    },
    editing
  )
  const canDropInto = useSidebarCanDropInto(folder.key)
  const isDraggingItem = sortable.dragKind === 'ITEM' && canDropInto
  const dropTarget = useDroppable({
    id: `sidebar-folder-${folder.key}`,
    data: {
      type: 'sidebar-folder-target',
      folderKey: folder.key,
      open: isOpen,
    } satisfies SidebarFolderTargetData,
    disabled: !isDraggingItem || parentCollapsed,
  })
  // Sortable and droppable share the element; either reporting "over" means the pointer is on it.
  const isDropOver = isDraggingItem && (dropTarget.isOver || sortable.isOver)

  const setRefs = useCallback(
    (el: HTMLLIElement | null) => {
      sortable.setNodeRef(el)
      dropTarget.setNodeRef(el)
    },
    [sortable.setNodeRef, dropTarget.setNodeRef]
  )

  const commitRename = () => {
    const title = draftTitle.trim()
    setEditing(false)
    if (!title || title === folder.title) return setDraftTitle(folder.title)
    void mutations.rename(folder.key, title)
  }
  const cancelRename = () => {
    setEditing(false)
    setDraftTitle(folder.title)
  }

  return (
    <SidebarMenuItem
      ref={setRefs}
      style={sortable.style}
      className={cn(
        'rounded-md transition-colors duration-150',
        sortable.isDragging && 'opacity-40',
        folder.ownHidden && 'opacity-50',
        isDraggingItem && 'outline-dashed outline-1 outline-primary/30 [outline-offset:-1px]',
        isDropOver && 'bg-primary/20 outline-primary/80 ring-2 ring-inset ring-primary/60'
      )}>
      <SidebarMenuButton
        asChild
        className='h-7 py-0 pe-[3px]'
        tooltip={folder.title}
        {...(editing ? {} : sortable.attributes)}
        {...(editing ? {} : sortable.listeners)}>
        <div
          className='group/item relative flex h-7 w-full cursor-pointer items-center justify-between'
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-no-toggle]') || editing) return
            toggleSection(sectionId, false)
          }}>
          {folder.ownHidden && <UnhideButton nodeKey={folder.key} />}
          <div className='flex min-w-0 grow items-center'>
            <Folder className='mr-2 size-4 shrink-0' />
            {editing ? (
              <input
                data-no-toggle
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelRename()
                  }
                }}
                className='h-5 min-w-0 grow rounded bg-background px-1 text-sm outline-none ring-1 ring-border'
              />
            ) : (
              <>
                <span className='truncate'>{folder.title}</span>
                <button
                  type='button'
                  data-no-toggle
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSection(sectionId, false)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className='ml-1 inline-flex shrink-0 items-center text-muted-foreground'>
                  <CollapsibleChevron open={isOpen} />
                </button>
              </>
            )}
          </div>

          {!editing && (
            <div
              data-no-toggle
              className='flex items-center'
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              onPointerDown={(e) => e.stopPropagation()}>
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className={cn(
                      'size-6 rounded-md opacity-100 sm:opacity-0 hover:bg-primary/10 hover:text-foreground/50 focus-visible:ring-primary/10 hover:bg-primary-200/50 data-[state=open]:opacity-100 data-[state=open]:bg-primary-200/50 data-[state=open]:text-foreground/50',
                      {
                        'sm:group-hover/item:opacity-100': !menuOpen,
                      }
                    )}>
                    <MoreVertical className='size-3.5' />
                    <span className='sr-only'>Folder options</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className='w-50' align='start'>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setDraftTitle(folder.title)
                        setEditing(true)
                      }}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant='destructive'
                      onClick={() => void mutations.remove(folder.key)}>
                      <Trash2 /> Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <LayoutMenuItems node={folder} />
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </SidebarMenuButton>

      <SidebarGroupCollapse open={isOpen}>
        <SidebarCollapsedContext.Provider value={parentCollapsed || !isOpen}>
          <SidebarMenuSub className='me-0 pe-0'>
            <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
              {folder.children.length > 0 ? (
                folder.children.map((child) => <SidebarTreeItem key={child.key} item={child} />)
              ) : (
                <li className='px-3 py-1 text-xs italic text-muted-foreground'>Empty folder</li>
              )}
            </SortableContext>
          </SidebarMenuSub>
        </SidebarCollapsedContext.Provider>
      </SidebarGroupCollapse>
    </SidebarMenuItem>
  )
}
