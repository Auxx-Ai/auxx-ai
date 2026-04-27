// ~/components/global/sidebar/views-group.tsx
'use client'

import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuSubItem } from '@auxx/ui/components/sidebar'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
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
import { TableProperties, Trash2 } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useDndState } from '~/app/context/dnd-state-context'
import { CollapsibleSidebarSection } from '~/components/global/sidebar/collapsible-sidebar-section'
import { EditableSidebarItem } from '~/components/global/sidebar/editable-sidebar-item'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { useMailCountsStore } from '~/components/mail/store'
import { MailViewDialog } from '~/components/mail-views/mail-view-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

export interface MailView {
  id: string
  name: string
  color: string
  unassignedCount?: number
  isVisible?: boolean
}

interface ViewsSectionProps {
  views: MailView[]
  isLoading: boolean
  isEditMode: boolean
  onToggleEditMode: () => void
  onUpdateViewsVisibility?: (viewId: string, isVisible: boolean) => void
  onReorderViews?: (orderedViewIds: string[]) => void
  isSectionVisible: boolean
  onToggleSectionVisibility: () => void
}

/**
 * Wrapper component to make a SidebarItem representing a mail view droppable.
 */
const DroppableViewSidebarItem = ({
  view,
  count,
  isEditMode,
  onToggleEditMode,
}: {
  view: MailView
  count: number
  isEditMode: boolean
  onToggleEditMode: () => void
}) => {
  const { activeDndItem } = useDndState()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const isDraggingThread = activeDndItem?.data.current?.type === 'thread'
  const utils = api.useUtils()

  const deleteMailView = api.mailView.delete.useMutation({
    onSuccess: () => {
      utils.mailView.getUserMailViews.invalidate()
      utils.mailView.getAllAccessibleMailViews.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting view', description: error.message })
    },
  })

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete this view?',
      description: 'This action cannot be undone. The view will be permanently deleted.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteMailView.mutate({ id: view.id })
    }
  }

  const { setNodeRef, isOver } = useDroppable({
    id: `view-${view.id}`,
    data: {
      type: 'view-target',
      viewId: view.id,
    },
    disabled: !isDraggingThread || isEditMode,
  })

  const itemHref = `/app/mail/views/${view.id}/unassigned`
  const pathname = usePathname()
  const isActive = pathname?.startsWith(`/app/mail/views/${view.id}`)

  const editItems = (
    <>
      <DropdownMenuItem onClick={() => setIsDialogOpen(true)}>
        <TableProperties />
        Edit View
      </DropdownMenuItem>
      <DropdownMenuItem variant='destructive' onClick={handleDelete}>
        <Trash2 />
        Delete View
      </DropdownMenuItem>
    </>
  )

  return (
    <>
      <ConfirmDialog />
      <div
        ref={setNodeRef}
        className={cn(
          'rounded-md transition-colors duration-150 ease-in-out',
          isDraggingThread && 'outline-solid outline-dashed outline-1 outline-primary/30',
          isDraggingThread && isOver && 'bg-primary/20 outline-primary/80 ring-2 ring-primary/60'
        )}>
        <MailViewDialog
          mailViewId={view.id}
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
        />
        <SidebarItem
          id={view.id}
          name={view.name}
          href={itemHref}
          count={count}
          color={view.color || 'indigo'}
          isSubmenu={true}
          isActive={isActive}
          editItems={editItems}
          onToggleEditMode={onToggleEditMode}
        />
      </div>
    </>
  )
}

export function ViewsSection({
  views,
  isLoading,
  isEditMode,
  onToggleEditMode,
  onUpdateViewsVisibility,
  onReorderViews,
  isSectionVisible,
  onToggleSectionVisibility,
}: ViewsSectionProps) {
  const pathname = usePathname()
  const [showCreateView, setShowCreateView] = useState(false)

  const viewCounts = useMailCountsStore((s) => s.counts.views)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleToggleVisibility = useCallback(
    (viewId: string) => {
      if (onUpdateViewsVisibility) {
        const currentView = views.find((i) => i.id === viewId)
        if (currentView) {
          onUpdateViewsVisibility(viewId, !(currentView.isVisible ?? true))
        }
      }
    },
    [views, onUpdateViewsVisibility]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id && onReorderViews) {
        const oldIndex = views.findIndex((item) => item.id === active.id)
        const newIndex = views.findIndex((item) => item.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrderedViews = arrayMove(views, oldIndex, newIndex)
          const newOrderIds = newOrderedViews.map((view) => view.id)
          onReorderViews(newOrderIds)
        }
      }
    },
    [views, onReorderViews]
  )

  const visibleViews = views?.filter((view) => view.isVisible) ?? []
  const allViewsIds = views?.map((view) => view.id) ?? []

  const renderViewList = () => {
    if (isLoading) {
      return Array(3)
        .fill(0)
        .map((_, i) => (
          <SidebarMenuSubItem key={`skeleton-${i}`}>
            <div className='flex items-center space-x-2 px-2 py-1.5'>
              <Skeleton className='h-4 w-4 rounded-full' />
              <Skeleton className='h-4 w-24' />
            </div>
          </SidebarMenuSubItem>
        ))
    }

    if (!isEditMode) {
      if (visibleViews.length === 0) {
        return (
          <SidebarMenuSubItem>
            <SidebarMenuButton
              variant='dashed'
              size='sm'
              onClick={() => setShowCreateView(true)}
              className='group-data-[collapsible=icon]:hidden'>
              Create a view
            </SidebarMenuButton>
          </SidebarMenuSubItem>
        )
      }

      return visibleViews.map((view) => {
        const count = viewCounts[view.id] ?? 0

        return (
          <SidebarMenuSubItem key={view.id}>
            <DroppableViewSidebarItem
              onToggleEditMode={onToggleEditMode}
              view={view}
              count={count}
              isEditMode={isEditMode}
            />
          </SidebarMenuSubItem>
        )
      })
    }

    return views.length > 0 ? (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={allViewsIds} strategy={verticalListSortingStrategy}>
          {views.map((view) => (
            <SidebarMenuSubItem key={view.id} className='p-0'>
              <EditableSidebarItem
                id={view.id}
                name={view.name}
                count={view.unassignedCount}
                isVisible={view.isVisible || false}
                isLocked={false}
                onToggleVisibility={handleToggleVisibility}
                isDraggable={true}
              />
            </SidebarMenuSubItem>
          ))}
        </SortableContext>
      </DndContext>
    ) : (
      <SidebarMenuSubItem>
        <div className='px-2 py-1.5 text-sm text-muted-foreground'>No views to edit</div>
      </SidebarMenuSubItem>
    )
  }

  const isAnyViewActive = pathname?.startsWith('/app/mail/views/')

  const actions = (
    <DropdownMenuItem
      onClick={() => setShowCreateView(true)}
      className='group-data-[collapsible=icon]:hidden!'>
      <TableProperties />
      Create view
    </DropdownMenuItem>
  )

  return (
    <>
      <MailViewDialog isOpen={showCreateView} onClose={() => setShowCreateView(false)} />
      <SidebarMenu className='gap-0'>
        <CollapsibleSidebarSection
          title='Views'
          icon={<TableProperties />}
          preventNavigation
          isEditMode={isEditMode}
          isActive={!!isAnyViewActive}
          defaultOpen
          sectionId='mail.views'
          actions={actions}
          isVisible={isSectionVisible}
          onToggleVisibility={onToggleSectionVisibility}>
          {renderViewList()}
        </CollapsibleSidebarSection>
      </SidebarMenu>
    </>
  )
}
