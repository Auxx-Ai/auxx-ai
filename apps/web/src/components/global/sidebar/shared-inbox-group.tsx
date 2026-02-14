// ~/components/global/sidebar/shared-inbox-group.tsx
'use client'

import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { SidebarGroup, SidebarMenu, SidebarMenuSubItem } from '@auxx/ui/components/sidebar'
import { Skeleton } from '@auxx/ui/components/skeleton'
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
import { Inbox, Mail } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useDndState } from '~/app/context/dnd-state-context'
import { CollapsibleSidebarSection } from '~/components/global/sidebar/collapsible-sidebar-section'
import { EditableSidebarItem } from '~/components/global/sidebar/editable-sidebar-item'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { InboxDialog } from '~/components/inbox/inbox-dialog'
import { selectSharedInboxesTotal, useMailCountsStore } from '~/components/mail/store'
import { useSidebarStateContext } from './sidebar-state-context'

// import { useDndState } from '~/context/dnd-state-context'; // <-- IMPORT NEW HOOK

export interface Inbox {
  id: string
  name: string
  color: string
  unassignedCount?: number
  isVisible?: boolean // Keep isVisible as it's managed by settings
}

interface SharedInboxesGroupProps {
  inboxes: Inbox[] // Use the processed inboxes from the hook
  isLoading: boolean
  isEditMode: boolean
  onToggleEditMode: () => void
  onUpdateInboxVisibility?: (inboxId: string, isVisible: boolean) => void
  onReorderInboxes?: (orderedInboxIds: string[]) => void // New prop for saving order
  isGroupVisible: boolean
  onToggleGroupVisibility: () => void
}

/**
 * Wrapper component to make a SidebarItem representing a shared inbox droppable.
 */
const DroppableInboxSidebarItem = ({
  inbox,
  count,
  isEditMode,
  onToggleEditMode,
}: {
  inbox: Inbox
  count: number
  isEditMode: boolean
  onToggleEditMode: () => void
}) => {
  // const { activeDragItem } = useMailFilter()
  // const isDraggingThread = activeDragItem?.data.current?.type === 'thread'
  const { activeDndItem } = useDndState() // <-- Use new hook

  const isDraggingThread = activeDndItem?.data.current?.type === 'thread'

  const { setNodeRef, isOver } = useDroppable({
    id: `shared-inbox-${inbox.id}`, // Unique ID for the drop target
    data: {
      type: 'shared-inbox-target', // Identify the drop target type
      inboxId: inbox.id,
    },
    disabled: !isDraggingThread || isEditMode, // Disable dropping while sidebar is in edit mode
  })

  const itemHref = `/app/mail/inboxes/${inbox.id}/unassigned` // Your existing logic
  const pathname = usePathname() // Get pathname if needed for isActive
  const isActive = pathname?.startsWith(`/app/mail/inboxes/${inbox.id}`)

  const editItems = (
    <>
      <DropdownMenuItem asChild>
        <Link href={`/app/settings/inbox/${inbox.id}?tab=settings`}>Edit Inbox</Link>
      </DropdownMenuItem>
    </>
  )

  return (
    <div
      ref={setNodeRef} // Assign the node ref for dnd-kit
      className={cn(
        'rounded-md transition-colors duration-150 ease-in-out', // Base styles for the droppable area
        isDraggingThread && 'outline-dashed outline-1 outline-primary/30',
        isDraggingThread && isOver && 'bg-primary/20 outline-primary/80 ring-2 ring-primary/60'
      )}>
      {/* Render the actual SidebarItem inside */}
      <SidebarItem
        id={inbox.id}
        name={inbox.name}
        href={itemHref}
        count={count}
        color={inbox.color || 'indigo'}
        isSubmenu={true}
        isActive={isActive}
        editItems={editItems}
        onToggleEditMode={onToggleEditMode}
      />
    </div>
  )
}

export function SharedInboxesGroup({
  inboxes, // This list is now pre-sorted and visibility-marked
  isLoading,
  isEditMode,
  onToggleEditMode,
  onUpdateInboxVisibility,
  onReorderInboxes, // Receive the handler
  isGroupVisible,
  onToggleGroupVisibility,
}: SharedInboxesGroupProps) {
  const pathname = usePathname()
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isOpen = getGroupOpen('shared')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const getInboxHref = (inboxId: string): string => {
    // Default to the "unassigned" view for a specific inbox
    return `/app/mail/inboxes/${inboxId}/unassigned`
  }

  const getAllInboxesHref = (): string => {
    // Default to the "unassigned" view for the "all inboxes" aggregate
    return `/app/mail/inboxes/all/unassigned`
  }

  // Use the mail counts store for counts
  const sharedInboxCounts = useMailCountsStore((s) => s.counts.sharedInboxes)
  const totalSharedCount = useMailCountsStore(selectSharedInboxesTotal)

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
      if (onUpdateInboxVisibility) {
        // Find the current state to toggle it
        const currentInbox = inboxes.find((i) => i.id === inboxId)
        if (currentInbox) {
          onUpdateInboxVisibility(inboxId, !(currentInbox.isVisible ?? true))
        }
      }
    },
    [inboxes, onUpdateInboxVisibility]
  )

  // Handle drag end event
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id && onReorderInboxes) {
        const oldIndex = inboxes.findIndex((item) => item.id === active.id)
        const newIndex = inboxes.findIndex((item) => item.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrderedInboxes = arrayMove(inboxes, oldIndex, newIndex)
          const newOrderIds = newOrderedInboxes.map((inbox) => inbox.id)
          onReorderInboxes(newOrderIds)
        }
      }
    },
    [inboxes, onReorderInboxes] // Depend on current inboxes and the callback
  )

  // Determine which inboxes to show in non-edit mode
  const visibleInboxes = inboxes.filter((inbox) => inbox.isVisible)
  // All inboxes are needed for edit mode (DndContext needs all potential items)
  const allInboxIds = inboxes.map((inbox) => inbox.id)

  const renderInboxList = () => {
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
      // Regular display mode (only visible items)
      return visibleInboxes && visibleInboxes.length > 0 ? (
        visibleInboxes.map((inbox) => {
          const itemHref = getInboxHref(inbox.id)
          // Check if the current path *starts with* the specific inbox base URL
          // This handles /inboxes/[id]/unassigned, /inboxes/[id]/assigned, /inboxes/[id]/assigned/[threadId] etc.
          const isActive = pathname?.startsWith(`/app/mail/inboxes/${inbox.id}`)
          const count = sharedInboxCounts[inbox.id] ?? 0

          return (
            <SidebarMenuSubItem key={inbox.id}>
              <DroppableInboxSidebarItem
                onToggleEditMode={onToggleEditMode}
                inbox={inbox}
                count={count}
                isEditMode={isEditMode}
              />
            </SidebarMenuSubItem>
          )
        })
      ) : (
        <SidebarMenuSubItem>
          <div className='px-2 py-1.5 text-sm text-muted-foreground'>No visible shared inboxes</div>
        </SidebarMenuSubItem>
      )
    } else {
      // Edit mode: Render all inboxes within Dnd context
      return inboxes.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <SortableContext
            items={allInboxIds} // Use IDs of all inboxes for context
            strategy={verticalListSortingStrategy}>
            {inboxes.map((inbox) => (
              // Use SidebarMenuSubItem to maintain visual structure if needed,
              // or directly render EditableSidebarItem if SubItem adds unwanted padding/styles in edit mode.
              // Let's keep SubItem for now for consistency.
              <SidebarMenuSubItem key={inbox.id} className='p-0'>
                <EditableSidebarItem
                  id={inbox.id}
                  name={inbox.name}
                  count={inbox.unassignedCount}
                  isVisible={inbox.isVisible || false}
                  isLocked={false} // Assuming shared inboxes aren't lockable for now
                  onToggleVisibility={handleToggleVisibility}
                  isDraggable={true} // Enable dragging features
                  // Pass color if needed for display in EditableSidebarItem
                  // color={inbox.color}
                />
              </SidebarMenuSubItem>
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        <SidebarMenuSubItem>
          <div className='px-2 py-1.5 text-sm text-muted-foreground'>No shared inboxes to edit</div>
        </SidebarMenuSubItem>
      )
    }
  }

  const allInboxesHref = getAllInboxesHref()
  const isSharedSectionActive = pathname?.startsWith('/app/mail/inboxes/') // Active if any inbox route is active

  function handleToggleOpen() {
    toggleGroup('shared')
  }

  const additionalOptions = (
    <>
      <DropdownMenuItem onSelect={() => setIsCreateDialogOpen(true)}>
        <Inbox />
        Create inbox
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  )

  // Don't render the group if it's hidden (unless in edit mode)
  if (!isGroupVisible && !isEditMode) {
    return null
  }

  return (
    <>
      <SidebarGroup className='group'>
        <SidebarGroupHeader
          title='Shared'
          isEditMode={isEditMode}
          onToggleEditMode={onToggleEditMode}
          additionalOptions={additionalOptions}
          toggleOpen={handleToggleOpen}
          isOpen={isOpen}
          isGroupVisible={isGroupVisible}
          onToggleGroupVisibility={onToggleGroupVisibility}
        />
        {(isEditMode || isOpen) && (
          <SidebarMenu className='gap-0'>
            <CollapsibleSidebarSection
              title='Shared Inboxes'
              avatar={
                <div className='flex size-5 shrink-0 items-center justify-center rounded-md bg-info'>
                  <Mail className='size-3 text-white/80' />
                </div>
              }
              href='/app/mail/inboxes/all/unassigned'
              isEditMode={isEditMode}
              defaultOpen // Keep open by default
              alwaysShowChildren // Content needs to be mounted for dnd-kit even if visually collapsed
              isActive={
                pathname?.startsWith(allInboxesHref) ||
                (isSharedSectionActive &&
                  !visibleInboxes.some((inbox) =>
                    pathname?.startsWith(`/app/mail/inboxes/${inbox.id}`)
                  ))
              }>
              {renderInboxList()}
            </CollapsibleSidebarSection>
          </SidebarMenu>
        )}
      </SidebarGroup>

      {isCreateDialogOpen && (
        <InboxDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} />
      )}
    </>
  )
}
