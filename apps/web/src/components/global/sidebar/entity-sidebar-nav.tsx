// apps/web/src/components/global/sidebar/entity-sidebar-nav.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import type { CustomResource } from '@auxx/lib/resources/client'
import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@auxx/ui/components/sidebar'
import { toastError } from '@auxx/ui/components/toast'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
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
import { Archive, LayoutTemplate, Pencil, Plus, Settings, Settings2 } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { EntityTemplateDialog } from '~/components/custom-fields/ui/entity-template-dialog'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { useEntityDefinitionMutations, useResources } from '~/components/resources/hooks'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { type ProcessedEntity, useEntitySidebar } from '~/hooks/use-entity-sidebar'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { EditableSidebarItem } from './editable-sidebar-item'
import { SidebarItem } from './sidebar-item'
import { useSidebarStateContext } from './sidebar-state-context'

/** Entity ID type for sidebar state */
type EntityDefinitionId = string

/**
 * Sidebar navigation component for dynamic entity definitions.
 * Displays entity definitions under "Records" section with icons.
 * Supports edit mode with drag-and-drop reordering and visibility toggles.
 */
export function EntitySidebarNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [editingEntityId, setEditingEntityId] = useState<EntityDefinitionId | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()
  const { archiveEntity } = useEntityDefinitionMutations()
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isOpen = getGroupOpen('records')
  const { isAtLimit, getLimit } = useFeatureFlags()
  const { customResources } = useResources()
  const userCreatedEntityCount = customResources?.filter((r) => !r.entityType).length ?? 0
  const atEntityLimit = isAtLimit(FeatureKey.entities, userCreatedEntityCount)
  const entityLimit = getLimit(FeatureKey.entities)

  // Use the entity sidebar hook for edit mode, visibility, and ordering
  const {
    isEditMode,
    entities,
    isLoading,
    toggleEditMode,
    updateEntityVisibility,
    updateEntityOrder,
    isGroupVisible,
    toggleGroupVisibility,
  } = useEntitySidebar()

  // DnD sensors setup
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Close edit mode when unmounting
  useEffect(() => {
    return () => {
      if (isEditMode) {
        toggleEditMode()
      }
    }
  }, [isEditMode, toggleEditMode])

  /** Toggle the Records group open/closed state */
  function handleToggleOpen() {
    toggleGroup('records')
  }

  /** Toggle entity visibility in edit mode */
  const handleToggleVisibility = useCallback(
    (entityId: string) => {
      const entity = entities.find((e) => e.id === entityId)
      if (entity && !entity.isLocked) {
        updateEntityVisibility(entityId, !entity.isVisible)
      }
    },
    [entities, updateEntityVisibility]
  )

  /** Handle drag end event for reordering */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id) {
        const oldIndex = entities.findIndex((item) => item.id === active.id)
        const newIndex = entities.findIndex((item) => item.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrderedEntities = arrayMove(entities, oldIndex, newIndex)
          const newOrderIds = newOrderedEntities.map((entity) => entity.id)
          updateEntityOrder(newOrderIds)
        }
      }
    },
    [entities, updateEntityOrder]
  )

  /** Open dialog in edit mode */
  function handleEditEntity(entity: CustomResource) {
    setEditingEntityId(entity.id)
    setDialogOpen(true)
  }

  /** Archive an entity definition */
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

  /** Check if an entity route is active */
  function isActive(entity: ProcessedEntity) {
    const url = entity.href
    return pathname === url || pathname.startsWith(`${url}/`)
  }

  /** Render icon component for entity definition */
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

  // Filtered entities for normal mode (only visible ones)
  const visibleEntities = entities.filter((e) => e.isVisible)
  const allEntityIds = entities.map((e) => e.id)
  const allItemsHidden = visibleEntities.length === 0

  /** Get edit items for an entity */
  function getEditItems(entity: ProcessedEntity) {
    // Find the corresponding custom resource for edit/archive actions
    const resource = customResources?.find((r) => r.id === entity.id)
    if (!resource) return null

    const isSystemEntity = !!resource.entityType

    return (
      <>
        {!isSystemEntity && (
          <DropdownMenuItem onClick={() => handleEditEntity(resource)}>
            <Pencil /> Edit Entity
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => router.push(`/app/settings/custom-fields/${entity.apiSlug}`)}>
          <Settings /> Manage Fields
        </DropdownMenuItem>
        {!isSystemEntity && <DropdownMenuSeparator />}
        {!isSystemEntity && (
          <DropdownMenuItem onClick={() => handleArchiveEntity(resource)} variant='destructive'>
            <Archive /> Archive
          </DropdownMenuItem>
        )}
      </>
    )
  }

  /** Render entity list in edit mode with DnD */
  function renderEditModeList() {
    if (entities.length === 0) {
      return (
        <SidebarMenuItem>
          <div className='px-2 py-1.5 text-sm text-muted-foreground'>No entities to edit</div>
        </SidebarMenuItem>
      )
    }

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={allEntityIds} strategy={verticalListSortingStrategy}>
          {entities.map((entity) => (
            <SidebarMenuItem key={entity.id} className='p-0'>
              <EditableSidebarItem
                id={entity.id}
                name={entity.plural}
                icon={renderIcon(entity.icon, entity.color)}
                isVisible={entity.isVisible}
                isLocked={entity.isLocked}
                onToggleVisibility={handleToggleVisibility}
                isDraggable={true}
              />
            </SidebarMenuItem>
          ))}
        </SortableContext>
      </DndContext>
    )
  }

  /** Render entity list in normal mode */
  function renderNormalModeList() {
    if (isLoading) {
      return (
        <>
          <SidebarMenuSkeleton showIcon />
          <SidebarMenuSkeleton showIcon />
        </>
      )
    }

    return visibleEntities.map((entity) => {
      const entityActive = isActive(entity)

      return (
        <SidebarMenuItem key={entity.id}>
          <SidebarItem
            id={entity.id}
            name={entity.plural}
            href={entity.href}
            icon={renderIcon(entity.icon, entity.color)}
            isActive={entityActive}
            editItems={getEditItems(entity)}
          />
        </SidebarMenuItem>
      )
    })
  }

  /** Handle create entity click — show limit dialog or open entity dialog */
  function handleCreateFromBlank(e: React.MouseEvent) {
    e.stopPropagation()
    if (atEntityLimit) {
      setLimitDialogOpen(true)
    } else {
      setEditingEntityId(null)
      setDialogOpen(true)
    }
  }

  /** Handle create from template click — show limit dialog or open template dialog */
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
          additionalOptions={
            <>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  router.push('/app/settings/custom-fields')
                }}>
                <Settings /> Manage Entities
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Create Entity</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleCreateFromBlank}>
                <Plus /> From Blank
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleCreateFromTemplate}
                className='data-highlighted:bg-[#ffaa40]/10'>
                <LayoutTemplate className='text-[#ffaa40]' />{' '}
                <AnimatedGradientText>From Template</AnimatedGradientText>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          }
        />

        {/* Empty state when all items hidden (but group is visible) */}
        {allItemsHidden && !isEditMode && isOpen && isGroupVisible && (
          <SidebarMenu className='gap-0'>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={toggleEditMode}>
                <Settings2 />
                <span>Edit Sidebar</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}

        {/* Entity list - only show when group is visible or in edit mode */}
        {(isEditMode || (isOpen && isGroupVisible)) && !allItemsHidden && (
          <SidebarMenu className='gap-0'>
            {isEditMode ? renderEditModeList() : renderNormalModeList()}
          </SidebarMenu>
        )}

        {/* Edit mode list when all items are hidden */}
        {isEditMode && allItemsHidden && (
          <SidebarMenu className='gap-0'>{renderEditModeList()}</SidebarMenu>
        )}
      </SidebarGroup>

      {/* Done button footer for edit mode */}
      {isEditMode && (
        <div className='flex shrink-0 items-center justify-end gap-2 border-t p-2'>
          <Button className='w-full rounded-md' size='sm' onClick={toggleEditMode}>
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
