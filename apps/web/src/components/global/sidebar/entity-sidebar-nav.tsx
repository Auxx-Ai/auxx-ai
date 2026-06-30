// apps/web/src/components/global/sidebar/entity-sidebar-nav.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import type { CustomResource } from '@auxx/lib/resources/client'
import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { Button } from '@auxx/ui/components/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  SidebarGroup,
  SidebarGroupCollapse,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@auxx/ui/components/sidebar'
import { toastError } from '@auxx/ui/components/toast'
import {
  type Active,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  Archive,
  FolderPlus,
  LayoutTemplate,
  Pencil,
  Plus,
  Settings,
  Settings2,
  Trash2,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { DndStateProvider } from '~/app/context/dnd-state-context'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { EntityTemplateDialog } from '~/components/custom-fields/ui/entity-template-dialog'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { useCreateEntityStore } from '~/components/global-create/create-entity-store'
import { useEntityDefinitionMutations, useResources } from '~/components/resources/hooks'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { type ProcessedEntity, useEntitySidebar } from '~/hooks/use-entity-sidebar'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { EditableSidebarItem } from './editable-sidebar-item'
import { EntityFolder, entityDndId, folderDndId } from './entity-folder'
import { SidebarItem } from './sidebar-item'
import { useSidebarStateContext } from './sidebar-state-context'

/** dnd-kit drag payload for Records nodes. */
interface DragData {
  kind: 'entity' | 'folder' | 'folderDrop'
  entityId?: string
  folderId?: string
  /** 'root' or a folder id — which container the dragged entity lives in. */
  container?: string
}

const ROOT = 'root'

/** The raw (unprefixed) id a drop target points at. */
function rawIdOf(d?: DragData): string | undefined {
  if (!d) return undefined
  return d.kind === 'entity' ? d.entityId : d.folderId
}

/**
 * Sidebar navigation for entity definitions ("Records").
 * Org-wide layout with folders, drag-and-drop reordering, and visibility
 * toggles — all editable by admins/owners inside Edit mode.
 */
export function EntitySidebarNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null)
  const [activeDndItem, setActiveDndItem] = useState<Active | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [draftFolderTitle, setDraftFolderTitle] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()
  const { archiveEntity, deleteEntity } = useEntityDefinitionMutations()
  const { isAdminOrOwner } = useUser()
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isOpen = getGroupOpen('records')
  const { isAtLimit, getLimit } = useFeatureFlags()
  const { customResources } = useResources()
  const userCreatedEntityCount = customResources?.filter((r) => !r.entityType).length ?? 0
  const atEntityLimit = isAtLimit(FeatureKey.entities, userCreatedEntityCount)
  const entityLimit = getLimit(FeatureKey.entities)

  const {
    isEditMode,
    tree,
    isLoading,
    canEdit,
    toggleEditMode,
    updateEntityVisibility,
    isGroupVisible,
    toggleGroupVisibility,
    reorderRoot,
    reorderWithinFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    moveEntityToFolder,
  } = useEntitySidebar()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Close edit mode when unmounting
  useEffect(() => {
    return () => {
      if (isEditMode) toggleEditMode()
    }
  }, [isEditMode, toggleEditMode])

  function handleToggleOpen() {
    toggleGroup('records')
  }

  // ── DnD ──────────────────────────────────────────────────────────────────
  const rootRawIds = tree.rootSequence.map((n) =>
    n.nodeType === 'FOLDER' ? n.folder.id : n.entity.id
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDndItem(event.active)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveDndItem(null)
      if (!over) return
      const a = active.data.current as DragData | undefined
      const o = over.data.current as DragData | undefined
      if (!a) return

      // Entity dropped onto a folder (its drop target or the folder row itself).
      if (a.kind === 'entity' && (o?.kind === 'folderDrop' || o?.kind === 'folder')) {
        if (a.container !== o.folderId) moveEntityToFolder(a.entityId!, o.folderId!)
        return
      }

      if (active.id === over.id) return

      // Folder reordered among root nodes.
      if (a.kind === 'folder') {
        const from = rootRawIds.indexOf(a.folderId!)
        const to = rootRawIds.indexOf(rawIdOf(o)!)
        if (from !== -1 && to !== -1 && from !== to) reorderRoot(arrayMove(rootRawIds, from, to))
        return
      }

      // Entity reorder / cross-container move.
      const overContainer = o?.container ?? ROOT
      if (overContainer === a.container) {
        if (a.container === ROOT) {
          const from = rootRawIds.indexOf(a.entityId!)
          const to = rootRawIds.indexOf(rawIdOf(o)!)
          if (from !== -1 && to !== -1 && from !== to) reorderRoot(arrayMove(rootRawIds, from, to))
        } else {
          const ids = (tree.folderItems[a.container!] ?? []).map((e) => e.id)
          const from = ids.indexOf(a.entityId!)
          const to = ids.indexOf(o?.entityId ?? '')
          if (from !== -1 && to !== -1 && from !== to)
            reorderWithinFolder(a.container!, arrayMove(ids, from, to))
        }
      } else if (overContainer === ROOT) {
        const idx = rootRawIds.indexOf(rawIdOf(o)!)
        moveEntityToFolder(a.entityId!, null, idx === -1 ? undefined : idx)
      } else {
        const idx = (tree.folderItems[overContainer] ?? []).findIndex((e) => e.id === o?.entityId)
        moveEntityToFolder(a.entityId!, overContainer, idx === -1 ? undefined : idx)
      }
    },
    [rootRawIds, tree.folderItems, moveEntityToFolder, reorderRoot, reorderWithinFolder]
  )

  // ── Entity actions ─────────────────────────────────────────────────────────
  function handleEditEntity(entity: CustomResource) {
    setEditingEntityId(entity.id)
    setDialogOpen(true)
  }

  async function handleArchiveEntity(entity: CustomResource) {
    const confirmed = await confirm({
      title: `Archive "${entity.label}"?`,
      description:
        'This entity will be archived and hidden. You can restore it later from Settings.',
      confirmText: 'Archive',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      archiveEntity.mutate(
        { id: entity.id },
        {
          onError: (error) => {
            toastError({ title: 'Failed to archive entity', description: error.message })
          },
        }
      )
    }
  }

  async function handleDeleteEntity(entity: CustomResource) {
    const confirmed = await confirm({
      title: `Delete "${entity.label}" permanently?`,
      description:
        `This permanently deletes ${entity.plural} — every record, all custom fields, and the ` +
        'opposite side of any relationships pointing to it. Sync connectors that target this ' +
        'entity will also be torn down. This cannot be undone.',
      confirmText: 'Delete permanently',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      deleteEntity.mutate(
        { id: entity.id },
        {
          onError: (error) => {
            toastError({ title: 'Failed to delete entity', description: error.message })
          },
        }
      )
    }
  }

  function isActive(entity: ProcessedEntity) {
    const url = entity.href
    return pathname === url || pathname.startsWith(`${url}/`)
  }

  function renderIcon(iconId: string, color: string) {
    return (
      <EntityIcon
        iconId={iconId}
        color={color ?? 'gray'}
        size='sm'
        inverse
        className='-ms-0.5 inset-shadow-xs inset-shadow-black/20'
      />
    )
  }

  /** Per-entity dropdown items (normal mode). */
  function getEditItems(entity: ProcessedEntity) {
    const resource = customResources?.find((r) => r.id === entity.id)
    if (!resource) return null

    const isSystemEntity = !!resource.entityType
    const canRemove = !isSystemEntity && isAdminOrOwner

    return (
      <>
        <DropdownMenuItem
          onClick={() =>
            useCreateEntityStore.getState().openDialog({ entityDefinitionId: entity.id })
          }>
          <Plus /> Create {entity.label}
        </DropdownMenuItem>
        {!isSystemEntity && (
          <DropdownMenuItem onClick={() => handleEditEntity(resource)}>
            <Pencil /> Edit Entity
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => router.push(`/app/settings/custom-fields/${entity.apiSlug}`)}>
          <Settings /> Manage Fields
        </DropdownMenuItem>
        {canRemove && <DropdownMenuSeparator />}
        {canRemove && (
          <DropdownMenuItem onClick={() => handleArchiveEntity(resource)} variant='destructive'>
            <Archive /> Archive
          </DropdownMenuItem>
        )}
        {canRemove && (
          <DropdownMenuItem onClick={() => handleDeleteEntity(resource)} variant='destructive'>
            <Trash2 /> Delete permanently
          </DropdownMenuItem>
        )}
      </>
    )
  }

  // ── Row renderers ──────────────────────────────────────────────────────────
  function renderEntityRowNormal(entity: ProcessedEntity, parentFolderId: string | null) {
    return (
      <SidebarMenuItem key={entity.id}>
        <SidebarItem
          id={entity.id}
          name={entity.plural}
          href={entity.href}
          icon={renderIcon(entity.icon, entity.color)}
          isActive={isActive(entity)}
          isSubmenu={parentFolderId !== null}
          editItems={getEditItems(entity)}
        />
      </SidebarMenuItem>
    )
  }

  function renderEntityRowEdit(entity: ProcessedEntity, parentFolderId: string | null) {
    return (
      <SidebarMenuItem key={entity.id} className='p-0'>
        <EditableSidebarItem
          id={entityDndId(entity.id)}
          name={entity.plural}
          icon={renderIcon(entity.icon, entity.color)}
          isVisible={entity.isVisible}
          isLocked={entity.isLocked}
          onToggleVisibility={() => updateEntityVisibility(entity.id, !entity.isVisible)}
          isDraggable={canEdit}
          showDropIndicator
          dndData={{ kind: 'entity', entityId: entity.id, container: parentFolderId ?? ROOT }}
        />
      </SidebarMenuItem>
    )
  }

  // ── Folder create ──────────────────────────────────────────────────────────
  function startCreateFolder() {
    setDraftFolderTitle('')
    setCreatingFolder(true)
  }

  function commitCreateFolder() {
    const title = draftFolderTitle.trim()
    if (title) createFolder(title)
    setCreatingFolder(false)
    setDraftFolderTitle('')
  }

  function cancelCreateFolder() {
    setCreatingFolder(false)
    setDraftFolderTitle('')
  }

  const folderDraftRow = creatingFolder ? (
    <SidebarItem
      id='__new_entity_folder__'
      name=''
      href='#'
      icon={<FolderPlus />}
      isEditing
      editValue={draftFolderTitle}
      onEditChange={setDraftFolderTitle}
      onEditCommit={commitCreateFolder}
      onEditCancel={cancelCreateFolder}
    />
  ) : null

  // ── Empty / content state ──────────────────────────────────────────────────
  const hasVisibleContent = tree.rootSequence.some((n) =>
    n.nodeType === 'FOLDER'
      ? (tree.folderItems[n.folder.id] ?? []).some((e) => e.isVisible)
      : n.entity.isVisible
  )

  function renderNormalModeList() {
    if (isLoading) {
      return (
        <>
          <SidebarMenuSkeleton showIcon />
          <SidebarMenuSkeleton showIcon />
        </>
      )
    }

    return tree.rootSequence.map((node) => {
      if (node.nodeType === 'FOLDER') {
        const items = (tree.folderItems[node.folder.id] ?? []).filter((e) => e.isVisible)
        return (
          <EntityFolder
            key={node.folder.id}
            folder={node.folder}
            items={items}
            isEditMode={false}
            canEdit={canEdit}
            onRename={renameFolder}
            onDelete={deleteFolder}
            renderChild={(entity) => renderEntityRowNormal(entity, node.folder.id)}
          />
        )
      }
      if (!node.entity.isVisible) return null
      return renderEntityRowNormal(node.entity, null)
    })
  }

  function renderEditModeList() {
    if (tree.rootSequence.length === 0) {
      return (
        <SidebarMenuItem>
          <div className='px-2 py-1.5 text-sm text-muted-foreground'>No entities to edit</div>
        </SidebarMenuItem>
      )
    }

    const rootIds = tree.rootSequence.map((n) =>
      n.nodeType === 'FOLDER' ? folderDndId(n.folder.id) : entityDndId(n.entity.id)
    )

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}>
        <DndStateProvider activeDndItem={activeDndItem}>
          <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
            {tree.rootSequence.map((node) => {
              if (node.nodeType === 'FOLDER') {
                return (
                  <EntityFolder
                    key={node.folder.id}
                    folder={node.folder}
                    items={tree.folderItems[node.folder.id] ?? []}
                    isEditMode
                    canEdit={canEdit}
                    onRename={renameFolder}
                    onDelete={deleteFolder}
                    renderChild={(entity) => renderEntityRowEdit(entity, node.folder.id)}
                  />
                )
              }
              return renderEntityRowEdit(node.entity, null)
            })}
          </SortableContext>
        </DndStateProvider>
      </DndContext>
    )
  }

  function handleCreateFromBlank(e: React.MouseEvent) {
    e.stopPropagation()
    if (atEntityLimit) {
      setLimitDialogOpen(true)
    } else {
      setEditingEntityId(null)
      setDialogOpen(true)
    }
  }

  function handleCreateFromTemplate(e: React.MouseEvent) {
    e.stopPropagation()
    if (atEntityLimit) {
      setLimitDialogOpen(true)
    } else {
      setTemplateDialogOpen(true)
    }
  }

  return (
    <>
      <SidebarGroup className='group'>
        <SidebarGroupHeader
          title='Records'
          isEditMode={isEditMode}
          onToggleEditMode={toggleEditMode}
          isOpen={isOpen}
          toggleOpen={handleToggleOpen}
          isGroupVisible={isGroupVisible}
          onToggleGroupVisibility={toggleGroupVisibility}
          hideEditOption={!canEdit}
          additionalOptions={
            <>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  router.push('/app/settings/custom-fields')
                }}>
                <Settings /> Manage Entities
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    startCreateFolder()
                  }}>
                  <FolderPlus /> New folder
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleCreateFromBlank}>
                <Plus /> Create entity
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleCreateFromTemplate}
                className='data-highlighted:bg-[#ffaa40]/10'>
                <LayoutTemplate className='text-[#ffaa40]' />{' '}
                <AnimatedGradientText>Create from template</AnimatedGradientText>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          }
        />

        {/* Empty state when nothing is visible (group still visible). */}
        <SidebarGroupCollapse
          open={!hasVisibleContent && !isEditMode && isOpen && isGroupVisible && canEdit}>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={toggleEditMode}>
                <Settings2 />
                <span>Edit Sidebar</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupCollapse>

        {/* Entity list. */}
        <SidebarGroupCollapse
          open={(isEditMode || (isOpen && isGroupVisible)) && (hasVisibleContent || isEditMode)}>
          <SidebarMenu className='gap-0'>
            {folderDraftRow}
            {isEditMode ? renderEditModeList() : renderNormalModeList()}
          </SidebarMenu>
        </SidebarGroupCollapse>
      </SidebarGroup>

      {/* Edit-mode footer. */}
      {isEditMode && (
        <div className='flex shrink-0 items-center justify-between gap-2 border-t p-2'>
          <Button variant='outline' size='sm' onClick={startCreateFolder}>
            <FolderPlus /> New folder
          </Button>
          <Button className='rounded-md' size='sm' onClick={toggleEditMode}>
            Done
          </Button>
        </div>
      )}

      {dialogOpen && (
        <EntityDefinitionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          entityDefinitionId={editingEntityId}
          onSuccess={({ apiSlug }) => {
            if (!editingEntityId) {
              router.push(`/app/custom/${apiSlug}`)
            }
          }}
        />
      )}

      <ConfirmDialog />

      <EntityTemplateDialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen} />

      <LimitReachedDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
        icon={Plus}
        title='Entity Limit Reached'
        description={`You've reached the maximum of ${entityLimit} custom entities on your current plan.`}
      />
    </>
  )
}
