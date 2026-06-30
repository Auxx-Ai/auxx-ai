// apps/web/src/components/global/sidebar/entity-folder.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { CollapsibleChevron } from '@auxx/ui/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Folder, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { useDndState } from '~/app/context/dnd-state-context'
import type { EntityFolder as EntityFolderType, ProcessedEntity } from '~/hooks/use-entity-sidebar'
import { useSidebarStateContext } from './sidebar-state-context'

/** Stable dnd id for an entity row (root or folder child). */
export const entityDndId = (id: string) => `entity:${id}`
/** Stable dnd id for a folder row (sortable among root nodes). */
export const folderDndId = (id: string) => `folder:${id}`
/** Stable dnd id for a folder's drop target. */
export const folderDropId = (id: string) => `folder-drop:${id}`

interface EntityFolderProps {
  folder: EntityFolderType
  items: ProcessedEntity[]
  isEditMode: boolean
  canEdit: boolean
  onRename: (folderId: string, title: string) => void
  onDelete: (folderId: string) => void
  /** Renders one entity row; nav decides normal (link) vs edit (sortable) row. */
  renderChild: (entity: ProcessedEntity, folderId: string) => ReactNode
}

/**
 * Collapsible Records folder. In edit mode the row is sortable (reorders among
 * root nodes) and a drop target (an entity dragged onto it moves into the
 * folder), mirroring the favorites folder. Read-only otherwise.
 */
export function EntityFolder({
  folder,
  items,
  isEditMode,
  canEdit,
  onRename,
  onDelete,
  renderChild,
}: EntityFolderProps) {
  const sectionId = `records.folder.${folder.id}`
  const { getSectionOpen, toggleSection } = useSidebarStateContext()
  const isOpen = getSectionOpen(sectionId, false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(folder.title)

  const commitRename = useCallback(() => {
    const title = draftTitle.trim()
    if (!title || title === folder.title) {
      setEditing(false)
      setDraftTitle(folder.title)
      return
    }
    onRename(folder.id, title)
    setEditing(false)
  }, [draftTitle, folder.id, folder.title, onRename])

  const cancelRename = useCallback(() => {
    setEditing(false)
    setDraftTitle(folder.title)
  }, [folder.title])

  // ── DnD bindings (edit mode only) ──────────────────────────────────────────
  const sortable = useSortable({
    id: folderDndId(folder.id),
    data: { kind: 'folder', folderId: folder.id, container: 'root' },
    disabled: !isEditMode || editing,
  })

  const { activeDndItem } = useDndState()
  const activeData = activeDndItem?.data.current as { kind?: string } | undefined
  const isDraggingEntity = activeData?.kind === 'entity'

  const dropTarget = useDroppable({
    id: folderDropId(folder.id),
    data: { kind: 'folderDrop', folderId: folder.id },
    disabled: !isEditMode || !isDraggingEntity,
  })

  const isFolderDropOver = isDraggingEntity && (dropTarget.isOver || sortable.isOver)

  const setRefs = useCallback(
    (el: HTMLLIElement | null) => {
      sortable.setNodeRef(el)
      dropTarget.setNodeRef(el)
    },
    [sortable.setNodeRef, dropTarget.setNodeRef]
  )

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }

  const childIds = items.map((e) => entityDndId(e.id))
  const showMenu = isEditMode && canEdit

  return (
    <SidebarMenuItem
      ref={setRefs}
      style={style}
      className={cn(
        'rounded-md transition-colors duration-150',
        sortable.isDragging && 'opacity-40',
        isDraggingEntity && 'outline-dashed outline-1 outline-blue-500/30 [outline-offset:-1px]',
        isFolderDropOver && 'bg-blue-500/10 ring-2 ring-inset ring-blue-500/50'
      )}>
      <SidebarMenuButton
        asChild
        className='h-7 py-0 pe-[3px]'
        tooltip={folder.title}
        {...(isEditMode && !editing ? sortable.attributes : {})}
        {...(isEditMode && !editing ? sortable.listeners : {})}>
        <div
          className='group/item relative flex h-7 w-full cursor-pointer items-center justify-between'
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-no-toggle]')) return
            if (editing) return
            toggleSection(sectionId)
          }}>
          <div className='flex min-w-0 items-center grow'>
            <Folder className='size-4 mr-2 shrink-0' />
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
                <span className='truncate group-data-[collapsible=icon]:hidden'>
                  {folder.title}
                </span>
                <button
                  type='button'
                  data-no-toggle
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSection(sectionId)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className='ml-1 inline-flex shrink-0 items-center text-muted-foreground group-data-[collapsible=icon]:hidden'>
                  <CollapsibleChevron open={isOpen} />
                </button>
              </>
            )}
          </div>

          {showMenu && !editing && (
            <div
              className='flex items-center group-data-[collapsible=icon]:hidden'
              data-no-toggle
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
                      'size-6 rounded-md opacity-100 sm:opacity-0 hover:bg-primary/10 focus-visible:ring-primary/10 hover:bg-primary-200/50',
                      {
                        'bg-primary-200 opacity-100': menuOpen,
                        'sm:group-hover/item:opacity-100': !menuOpen,
                      }
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setMenuOpen(!menuOpen)
                    }}>
                    <MoreVertical className='size-3.5' />
                    <span className='sr-only'>Folder options</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className='w-50' align='start'>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        setDraftTitle(folder.title)
                        setEditing(true)
                      }}>
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant='destructive'
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(folder.id)
                      }}>
                      <Trash2 />
                      Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </SidebarMenuButton>

      <SidebarGroupCollapse open={isOpen || isEditMode}>
        <SidebarMenuSub className='me-0 pe-0'>
          {isEditMode ? (
            <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
              {items.length > 0 ? (
                items.map((entity) => renderChild(entity, folder.id))
              ) : (
                <li className='px-3 py-1 text-xs text-muted-foreground italic'>Empty folder</li>
              )}
            </SortableContext>
          ) : items.length > 0 ? (
            items.map((entity) => renderChild(entity, folder.id))
          ) : null}
        </SidebarMenuSub>
      </SidebarGroupCollapse>
    </SidebarMenuItem>
  )
}
