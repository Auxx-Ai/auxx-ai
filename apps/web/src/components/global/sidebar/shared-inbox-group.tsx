// ~/components/global/sidebar/shared-inbox-group.tsx
'use client'

import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { SidebarMenu, SidebarMenuSubItem } from '@auxx/ui/components/sidebar'
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
import { Inbox as InboxIcon, Mail } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useDndState } from '~/app/context/dnd-state-context'
import { CollapsibleSidebarSection } from '~/components/global/sidebar/collapsible-sidebar-section'
import { EditableSidebarItem } from '~/components/global/sidebar/editable-sidebar-item'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { InboxDialog } from '~/components/inbox/inbox-dialog'
import { selectSharedInboxesTotal, useMailCountsStore } from '~/components/mail/store'

export interface Inbox {
  id: string
  name: string
  color: string
  unassignedCount?: number
  isVisible?: boolean
}

interface SharedInboxesSectionProps {
  inboxes: Inbox[]
  isLoading: boolean
  isEditMode: boolean
  onToggleEditMode: () => void
  onUpdateInboxVisibility?: (inboxId: string, isVisible: boolean) => void
  onReorderInboxes?: (orderedInboxIds: string[]) => void
  isSectionVisible: boolean
  onToggleSectionVisibility: () => void
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
  const { activeDndItem } = useDndState()

  const isDraggingThread = activeDndItem?.data.current?.type === 'thread'

  const { setNodeRef, isOver } = useDroppable({
    id: `shared-inbox-${inbox.id}`,
    data: {
      type: 'shared-inbox-target',
      inboxId: inbox.id,
    },
    disabled: !isDraggingThread || isEditMode,
  })

  const itemHref = `/app/mail/inboxes/${inbox.id}/unassigned`
  const pathname = usePathname()
  const isActive = pathname?.startsWith(`/app/mail/inboxes/${inbox.id}`)

  const editItems = (
    <DropdownMenuItem asChild>
      <Link href={`/app/settings/inbox/${inbox.id}?tab=settings`}>Edit Inbox</Link>
    </DropdownMenuItem>
  )

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md transition-colors duration-150 ease-in-out',
        isDraggingThread && 'outline-dashed outline-1 outline-primary/30',
        isDraggingThread && isOver && 'bg-primary/20 outline-primary/80 ring-2 ring-primary/60'
      )}>
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

export function SharedInboxesSection({
  inboxes,
  isLoading,
  isEditMode,
  onToggleEditMode,
  onUpdateInboxVisibility,
  onReorderInboxes,
  isSectionVisible,
  onToggleSectionVisibility,
}: SharedInboxesSectionProps) {
  const pathname = usePathname()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  const sharedInboxCounts = useMailCountsStore((s) => s.counts.sharedInboxes)
  const totalSharedCount = useMailCountsStore(selectSharedInboxesTotal)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleToggleVisibility = useCallback(
    (inboxId: string) => {
      if (onUpdateInboxVisibility) {
        const currentInbox = inboxes.find((i) => i.id === inboxId)
        if (currentInbox) {
          onUpdateInboxVisibility(inboxId, !(currentInbox.isVisible ?? true))
        }
      }
    },
    [inboxes, onUpdateInboxVisibility]
  )

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
    [inboxes, onReorderInboxes]
  )

  const visibleInboxes = inboxes.filter((inbox) => inbox.isVisible)
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
      return visibleInboxes && visibleInboxes.length > 0 ? (
        visibleInboxes.map((inbox) => {
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
    }

    return inboxes.length > 0 ? (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={allInboxIds} strategy={verticalListSortingStrategy}>
          {inboxes.map((inbox) => (
            <SidebarMenuSubItem key={inbox.id} className='p-0'>
              <EditableSidebarItem
                id={inbox.id}
                name={inbox.name}
                count={inbox.unassignedCount}
                isVisible={inbox.isVisible || false}
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
        <div className='px-2 py-1.5 text-sm text-muted-foreground'>No shared inboxes to edit</div>
      </SidebarMenuSubItem>
    )
  }

  const allInboxesHref = '/app/mail/inboxes/all/unassigned'
  const isSharedSectionActive = pathname?.startsWith('/app/mail/inboxes/')
  const isHeaderActive =
    pathname?.startsWith(allInboxesHref) ||
    (isSharedSectionActive &&
      !visibleInboxes.some((inbox) => pathname?.startsWith(`/app/mail/inboxes/${inbox.id}`)))

  const actions = (
    <DropdownMenuItem onSelect={() => setIsCreateDialogOpen(true)}>
      <InboxIcon />
      Create inbox
    </DropdownMenuItem>
  )

  return (
    <>
      <SidebarMenu className='gap-0'>
        <CollapsibleSidebarSection
          title='Shared Inboxes'
          avatar={
            <div className='flex size-5 shrink-0 items-center justify-center rounded-md bg-info'>
              <Mail className='size-3 text-white/80' />
            </div>
          }
          href={allInboxesHref}
          isEditMode={isEditMode}
          defaultOpen
          sectionId='mail.shared'
          actions={actions}
          isVisible={isSectionVisible}
          onToggleVisibility={onToggleSectionVisibility}
          count={totalSharedCount}
          isActive={!!isHeaderActive}>
          {renderInboxList()}
        </CollapsibleSidebarSection>
      </SidebarMenu>

      {isCreateDialogOpen && (
        <InboxDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} />
      )}
    </>
  )
}
