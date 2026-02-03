// ~/components/global/sidebar/personal-mail-group.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'

import { SidebarGroup, SidebarMenu, SidebarMenuItem } from '@auxx/ui/components/sidebar'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { EditableSidebarItem } from '~/components/global/sidebar/editable-sidebar-item'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Inbox as InboxIcon, Send, FileEdit } from 'lucide-react'
import { useMailCountsStore } from '~/components/mail/store'
import { useSidebarStateContext } from './sidebar-state-context'

// Import necessary DnD Kit components
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'

export interface PersonalMenuItem {
  id: string
  name: string
  icon: React.ReactNode
  visible: boolean
  order: number
  count?: number
}

interface PersonalMailGroupProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  settings?: PersonalMenuItem[]
  onUpdateSettings: (items: PersonalMenuItem[]) => void
  settingsLoading: boolean
  isGroupVisible: boolean
  onToggleGroupVisibility: () => void
}

// Default items if none exist in settings
const DEFAULT_PERSONAL_ITEMS: PersonalMenuItem[] = [
  {
    id: 'inbox',
    name: 'Inbox',
    icon: <InboxIcon className="size-4" />,
    visible: true,
    order: 0,
    count: 0,
  },
  {
    id: 'drafts',
    name: 'Drafts',
    icon: <FileEdit className="size-4" />,
    visible: true,
    order: 1,
    count: undefined,
  },
  {
    id: 'sent',
    name: 'Sent',
    icon: <Send className="size-4" />,
    visible: true,
    order: 2,
    count: undefined,
  },
]

export function PersonalMailGroup({
  isEditMode,
  onToggleEditMode,
  settings,
  onUpdateSettings,
  settingsLoading,
  isGroupVisible,
  onToggleGroupVisibility,
}: PersonalMailGroupProps) {
  const pathname = usePathname()
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isOpen = getGroupOpen('personal')

  // Use settings if available, otherwise use defaults
  const [items, setItems] = useState<PersonalMenuItem[]>(DEFAULT_PERSONAL_ITEMS)

  // Use the mail counts store for counts
  const inboxCount = useMailCountsStore((s) => s.counts.inbox)
  const draftsCount = useMailCountsStore((s) => s.counts.drafts)
  const isInitialLoading = useMailCountsStore((s) => s.isInitialLoading)

  // Setup DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require a small movement to start dragging (prevents accidental drags)
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Update items when settings or counts change
  useEffect(() => {
    if (settings) {
      // Merge default items with settings and apply correct counts from store
      const mergedItems = DEFAULT_PERSONAL_ITEMS.map((defaultItem) => {
        const settingItem = settings.find((s) => s.id === defaultItem.id)
        const baseItem = settingItem ? { ...defaultItem, ...settingItem } : defaultItem

        // Apply correct counts from store
        let count: number | undefined = undefined
        if (defaultItem.id === 'inbox') {
          count = inboxCount
        } else if (defaultItem.id === 'drafts') {
          count = draftsCount > 0 ? draftsCount : undefined
        }
        // sent has no count

        return { ...baseItem, count }
      })

      setItems(mergedItems)
    }
  }, [settings, inboxCount, draftsCount])

  const getItemHref = (item: PersonalMenuItem): string => {
    // Drafts and Sent go directly to their base path
    if (item.id === 'drafts' || item.id === 'sent') {
      return `/app/mail/${item.id}`
    }
    // Inbox goes to its base path + '/open' by default
    if (item.id === 'inbox') {
      return `/app/mail/${item.id}/open`
    }
    // Fallback
    return '/app/mail'
  }

  // Toggle visibility of an item
  const toggleItemVisibility = (itemId: string) => {
    if (isEditMode) {
      const updatedItems = items.map((item) =>
        item.id === itemId ? { ...item, visible: !item.visible } : item
      )

      setItems(updatedItems)
      // Save to settings
      const itemsToSave = updatedItems.map((item) => {
        const { icon, ...itemWithoutIcon } = item
        return itemWithoutIcon
      })
      onUpdateSettings(itemsToSave)
    }
  }

  // Handle drag end event
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id) {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1) {
          // Create a new array with the moved item
          const newOrderedItems = arrayMove(items, oldIndex, newIndex)

          // Update order values based on new positions
          const updatedItems = newOrderedItems.map((item, index) => ({
            ...item,
            order: index,
          }))

          // Update local state
          setItems(updatedItems)

          // Save the updated settings
          const itemsToSave = updatedItems.map((item) => {
            const { icon, ...itemWithoutIcon } = item
            return itemWithoutIcon
          })
          onUpdateSettings(itemsToSave)
        }
      }
    },
    [items, onUpdateSettings]
  )

  // Filter visible items (in normal mode)
  const visibleItems = isEditMode ? items : items.filter((item) => item.visible)

  // Get IDs for the sortable context
  const itemIds = items.map((item) => item.id)

  function handleToggleOpen() {
    toggleGroup('personal')
  }

  // Don't render the group if it's hidden (unless in edit mode)
  if (!isGroupVisible && !isEditMode) {
    return null
  }

  if (settingsLoading || isInitialLoading) {
    return (
      <SidebarGroup className="group">
        <SidebarGroupHeader
          title="Me"
          isEditMode={isEditMode}
          onToggleEditMode={onToggleEditMode}
          toggleOpen={handleToggleOpen}
          isOpen={isOpen}
          isGroupVisible={isGroupVisible}
          onToggleGroupVisibility={onToggleGroupVisibility}
        />
        <SidebarMenu className="gap-0">
          <div className="space-y-1 px-2">
            {Array(3)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-[26px] w-full" />
              ))}
          </div>
        </SidebarMenu>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup className="group">
      <SidebarGroupHeader
        title="Me"
        isEditMode={isEditMode}
        onToggleEditMode={onToggleEditMode}
        toggleOpen={handleToggleOpen}
        isOpen={isOpen}
        isGroupVisible={isGroupVisible}
        onToggleGroupVisibility={onToggleGroupVisibility}
      />
      {(isEditMode || isOpen) && (
        <SidebarMenu className="gap-0">
          {isEditMode ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis]}>
              <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                {items
                  .sort((a, b) => a.order - b.order)
                  .map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <EditableSidebarItem
                        id={item.id}
                        name={item.name}
                        icon={item.icon}
                        count={item.count}
                        isVisible={item.visible}
                        onToggleVisibility={toggleItemVisibility}
                        isDraggable={true}
                      />
                    </SidebarMenuItem>
                  ))}
              </SortableContext>
            </DndContext>
          ) : (
            <>
              {visibleItems
                .sort((a, b) => a.order - b.order)
                .map((item) => {
                  const itemHref = getItemHref(item)
                  const isActive =
                    pathname === itemHref || pathname?.startsWith(itemHref.replace(/\/open$/, '/'))

                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarItem
                        id={item.id}
                        name={item.name}
                        href={itemHref}
                        icon={item.icon}
                        count={item.count}
                        isActive={isActive}
                        onToggleEditMode={onToggleEditMode}
                      />
                    </SidebarMenuItem>
                  )
                })}
            </>
          )}
        </SidebarMenu>
      )}
    </SidebarGroup>
  )
}
