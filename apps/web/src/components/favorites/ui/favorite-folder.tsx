// apps/web/src/components/favorites/ui/favorite-folder.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
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
import { useCallback, useState } from 'react'
import { useDndState } from '~/app/context/dnd-state-context'
import { useSidebarState } from '~/hooks/use-sidebar-state'
import { api } from '~/trpc/react'
import { useFavoritesStore } from '../store/favorites-store'
import { SortableFavoriteRow } from './sortable-favorite-row'

interface FavoriteFolderProps {
  folder: FavoriteEntity
  items: FavoriteEntity[]
  index: number
}

/**
 * Folder row that is itself sortable (reorders among root nodes) and a drop
 * target (an item-drag dropped here moves the item into the folder). The
 * entire row is the drag handle; the global PointerSensor's distance: 8
 * activation constraint keeps clicks alive.
 */
export function FavoriteFolder({ folder, items, index }: FavoriteFolderProps) {
  const sectionId = `favorites.folder.${folder.id}`
  const sidebarState = useSidebarState()
  const isOpen = sidebarState.getSectionOpen(sectionId, false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(folder.title ?? '')

  const removeById = useFavoritesStore((s) => s.removeById)
  const upsert = useFavoritesStore((s) => s.upsert)
  const utils = api.useUtils()
  const renameMutation = api.favorite.renameFolder.useMutation({
    onSuccess: () => void utils.favorite.list.invalidate(),
  })
  const deleteMutation = api.favorite.deleteFolder.useMutation({
    onSuccess: () => void utils.favorite.list.invalidate(),
  })

  const commitRename = useCallback(() => {
    const title = draftTitle.trim()
    if (!title || title === folder.title) {
      setEditing(false)
      setDraftTitle(folder.title ?? '')
      return
    }
    upsert({ ...folder, title })
    renameMutation.mutate({ folderId: folder.id, title })
    setEditing(false)
  }, [draftTitle, folder, upsert, renameMutation])

  const cancelRename = useCallback(() => {
    setEditing(false)
    setDraftTitle(folder.title ?? '')
  }, [folder.title])

  const handleDelete = useCallback(() => {
    removeById(folder.id)
    deleteMutation.mutate({ folderId: folder.id })
  }, [removeById, deleteMutation, folder.id])

  // ── DnD bindings ─────────────────────────────────────────────────────────
  const sortable = useSortable({
    id: `favorite-row-${folder.id}`,
    data: {
      type: 'favorite',
      favoriteId: folder.id,
      nodeType: 'FOLDER' as const,
      parentFolderId: null,
      index,
    },
    disabled: editing,
  })

  const { activeDndItem } = useDndState()
  const activeData = activeDndItem?.data.current as
    | { type?: string; nodeType?: string; favoriteId?: string }
    | undefined
  const isDraggingFavoriteItem = activeData?.type === 'favorite' && activeData.nodeType === 'ITEM'

  const dropTarget = useDroppable({
    id: `favorite-folder-${folder.id}`,
    data: { type: 'favorite-folder-target', folderId: folder.id },
    disabled: !isDraggingFavoriteItem,
  })

  // Both useSortable and useDroppable are registered on the same element; either
  // one detecting "over" means the user is hovering this folder during a drag.
  const isFolderDropOver = isDraggingFavoriteItem && (dropTarget.isOver || sortable.isOver)

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

  const childIds = items.map((it) => `favorite-row-${it.id}`)

  return (
    <>
      <SidebarMenuItem
        ref={setRefs}
        style={style}
        className={cn(
          'rounded-md transition-colors duration-150',
          sortable.isDragging && 'opacity-40',
          isDraggingFavoriteItem &&
            'outline-dashed outline-1 outline-primary/30 [outline-offset:-1px]',
          isFolderDropOver && 'bg-primary/20 outline-primary/80 ring-2 ring-inset ring-primary/60'
        )}>
        <SidebarMenuButton
          asChild
          className='h-7 py-0 pe-[3px]'
          tooltip={folder.title ?? 'Folder'}
          {...(editing ? {} : sortable.attributes)}
          {...(editing ? {} : sortable.listeners)}>
          <div
            className='group/item relative flex h-7 w-full cursor-pointer items-center justify-between'
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[data-no-toggle]')) return
              if (editing) return
              sidebarState.toggleSection(sectionId)
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
                      sidebarState.toggleSection(sectionId)
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className='ml-1 inline-flex shrink-0 items-center text-muted-foreground group-data-[collapsible=icon]:hidden'>
                    <CollapsibleChevron open={isOpen} />
                  </button>
                </>
              )}
            </div>

            <div className='flex items-center group-data-[collapsible=icon]:hidden'>
              {!editing && (
                <div
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
                          'size-6 rounded-md opacity-100 sm:opacity-0 hover:bg-primary/10 hover:text-foreground/50 focus-visible:ring-primary/10 hover:bg-primary-200/50',
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
                            setDraftTitle(folder.title ?? '')
                            setEditing(true)
                          }}>
                          <Pencil />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete()
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
          </div>
        </SidebarMenuButton>

        <SidebarGroupCollapse open={isOpen}>
          <SidebarMenuSub className='me-0 pe-0'>
            <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
              {items.length > 0 ? (
                items.map((it, i) => (
                  <SortableFavoriteRow
                    key={it.id}
                    favorite={it}
                    parentFolderId={folder.id}
                    index={i}
                  />
                ))
              ) : (
                <li className='px-3 py-1 text-xs text-muted-foreground italic'>Empty folder</li>
              )}
            </SortableContext>
          </SidebarMenuSub>
        </SidebarGroupCollapse>
      </SidebarMenuItem>
    </>
  )
}
