// ~/components/global/sidebar/views-group.tsx
'use client'

import { useCallback, useState } from 'react'
import { usePathname } from 'next/navigation'

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubItem,
} from '@auxx/ui/components/sidebar'
import { CollapsibleSidebarSection } from '~/components/global/sidebar/collapsible-sidebar-section'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { EditableSidebarItem } from '~/components/global/sidebar/editable-sidebar-item'
import { Lock, Mail, TableProperties, Trash2, Users } from 'lucide-react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useSidebarStateContext } from './sidebar-state-context'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDroppable,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { cn } from '@auxx/ui/lib/utils'
import { useDndState } from '~/app/context/dnd-state-context'
import { api } from '~/trpc/react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import Link from 'next/link'
import { MailViewDialog } from '~/components/mail-views/mail-view-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'

// import { useDndState } from '~/context/dnd-state-context'; // <-- IMPORT NEW HOOK

export interface MailView {
  id: string
  name: string
  color: string
  unassignedCount?: number
  isVisible?: boolean // Keep isVisible as it's managed by settings
}

interface ViewsGroupProps {
  views: MailView[] // Use the processed inboxes from the hook
  isLoading: boolean
  isEditMode: boolean
  onToggleEditMode: () => void
  onUpdateViewsVisibility?: (viewId: string, isVisible: boolean) => void
  onReorderViews?: (orderedViewIds: string[]) => void // New prop for saving order
  isGroupVisible: boolean
  onToggleGroupVisibility: () => void
}

/**
 * Wrapper component to make a SidebarItem representing a shared inbox droppable.
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
  // const { activeDragItem } = useMailFilter()
  // const isDraggingThread = activeDragItem?.data.current?.type === 'thread'
  const { activeDndItem } = useDndState() // <-- Use new hook
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

  /** Handles the delete action with confirmation */
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
    id: `view-${view.id}`, // Unique ID for the drop target
    data: {
      type: 'view-target', // Identify the drop target type
      viewId: view.id,
    },
    disabled: !isDraggingThread || isEditMode, // Disable dropping while sidebar is in edit mode
  })

  const itemHref = `/app/mail/views/${view.id}/unassigned` // Your existing logic
  const pathname = usePathname() // Get pathname if needed for isActive
  const isActive = pathname?.startsWith(`/app/mail/views/${view.id}`)

  const editItems = (
    <>
      <DropdownMenuItem onClick={() => setIsDialogOpen(true)}>
        <TableProperties />
        Edit View
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={handleDelete}>
        <Trash2 />
        Delete View
      </DropdownMenuItem>
    </>
  )

  return (
    <>
      <ConfirmDialog />
      <div
        ref={setNodeRef} // Assign the node ref for dnd-kit
        className={cn(
          'rounded-md transition-colors duration-150 ease-in-out', // Base styles for the droppable area
          isDraggingThread && 'outline-solid outline-dashed outline-1 outline-primary/30',
          isDraggingThread && isOver && 'bg-primary/20 outline-primary/80 ring-2 ring-primary/60'
        )}>
        <MailViewDialog
          mailViewId={view.id}
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
        />
        {/* Render the actual SidebarItem inside */}
        <SidebarItem
          id={view.id}
          name={view.name}
          href={itemHref}
          count={count}
          color={view.color || '#4f46e5'}
          isSubmenu={true}
          isActive={isActive}
          editItems={editItems}
          onToggleEditMode={onToggleEditMode}
        />
      </div>
    </>
  )
}

export function ViewsGroup({
  views, // This list is now pre-sorted and visibility-marked
  isLoading,
  isEditMode,
  onToggleEditMode,
  onUpdateViewsVisibility,
  onReorderViews, // Receive the handler
  isGroupVisible,
  onToggleGroupVisibility,
}: ViewsGroupProps) {
  const pathname = usePathname()
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isOpen = getGroupOpen('views')
  const [showCreateView, setShowCreateView] = useState(false)
  const getViewHref = (inboxId: string): string => {
    // Default to the "unassigned" view for a specific inbox
    return `/app/mail/views/${inboxId}/unassigned`
  }

  const { data: unreadCounts, isLoading: isLoadingCounts, error } = api.thread.getCounts.useQuery()

  // Dnd-kit sensors setup
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require the mouse to move by 10 pixels before starting a drag
      // helps prevent drags initiated accidentally on click
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Toggle inbox visibility (pass through to hook via prop)
  const handleToggleVisibility = useCallback(
    (inboxId: string) => {
      if (onUpdateViewsVisibility) {
        // Find the current state to toggle it
        const currentInbox = views.find((i) => i.id === inboxId)
        if (currentInbox) {
          onUpdateViewsVisibility(inboxId, !(currentInbox.isVisible ?? true))
        }
      }
    },
    [views, onUpdateViewsVisibility]
  )

  // Handle drag end event
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
    [views, onReorderViews] // Depend on current inboxes and the callback
  )

  // Determine which inboxes to show in non-edit mode
  const visibleViews = views?.filter((view) => view.isVisible)
  const allViewsIds = views?.map((view) => view.id)

  function handleToggleOpen() {
    toggleGroup('views')
  }

  const renderViewList = () => {
    if (isLoading) {
      return Array(3)
        .fill(0)
        .map((_, i) => (
          <SidebarMenuItem key={`skeleton-${i}`}>
            <div className="flex items-center space-x-2 px-2 py-1.5">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </SidebarMenuItem>
        ))
    }

    if (!isEditMode) {
      if (visibleViews.length === 0) {
        return (
          <SidebarMenuButton variant="dashed" size="sm" onClick={() => setShowCreateView(true)}>
            Create a view
          </SidebarMenuButton>
        )
      }

      return visibleViews.map((view) => {
        const itemHref = getViewHref(view.id)
        // Check if the current path *starts with* the specific inbox base URL
        // This handles /inboxes/[id]/unassigned, /inboxes/[id]/assigned, /inboxes/[id]/assigned/[threadId] etc.
        const isActive = pathname?.startsWith(`/app/mail/views/${view.id}`)
        const count = unreadCounts?.[view.id] ?? 0

        return (
          <SidebarMenuItem key={view.id}>
            <DroppableViewSidebarItem
              onToggleEditMode={onToggleEditMode}
              view={view}
              count={count}
              isEditMode={isEditMode}
            />
          </SidebarMenuItem>
        )
      })
    } else {
      // Edit mode: Render all inboxes within Dnd context
      return views.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <SortableContext
            items={allViewsIds} // Use IDs of all inboxes for context
            strategy={verticalListSortingStrategy}>
            {views.map((view) => (
              <SidebarMenuItem key={view.id} className="p-0">
                <EditableSidebarItem
                  id={view.id}
                  name={view.name}
                  count={view.unassignedCount}
                  isVisible={view.isVisible || false}
                  isLocked={false} // Assuming shared inboxes aren't lockable for now
                  onToggleVisibility={handleToggleVisibility}
                  isDraggable={true} // Enable dragging features
                />
              </SidebarMenuItem>
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        <SidebarMenuItem>
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No views to edit</div>
        </SidebarMenuItem>
      )
    }
  }

  const additionalOptions = (
    <>
      <DropdownMenuItem onClick={() => setShowCreateView(true)}>
        <TableProperties />
        Create view
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  )

  const isSharedSectionActive = pathname?.startsWith('/app/mail/views/') // Active if any inbox route is active

  // Don't render the group if it's hidden (unless in edit mode)
  if (!isGroupVisible && !isEditMode) {
    return null
  }

  return (
    <>
      <MailViewDialog isOpen={showCreateView} onClose={() => setShowCreateView(false)} />
      <SidebarGroup className="group">
        <SidebarGroupHeader
          title="Views"
          isEditMode={isEditMode}
          onToggleEditMode={onToggleEditMode}
          toggleOpen={handleToggleOpen}
          additionalOptions={additionalOptions}
          isOpen={isOpen}
          isGroupVisible={isGroupVisible}
          onToggleGroupVisibility={onToggleGroupVisibility}
        />
        {(isEditMode || isOpen) && <SidebarMenu className="gap-0">{renderViewList()}</SidebarMenu>}
      </SidebarGroup>
    </>
  )
}
