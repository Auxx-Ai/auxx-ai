// ~/components/global/sidebar/personal-mail-group.tsx
'use client'

import { SidebarMenuItem } from '@auxx/ui/components/sidebar'
import { Skeleton } from '@auxx/ui/components/skeleton'
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
import { FileEdit, Inbox as InboxIcon, Send } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { EditableSidebarItem } from '~/components/global/sidebar/editable-sidebar-item'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { useMailCountsStore } from '~/components/mail/store'

export interface PersonalMenuItem {
  id: string
  name: string
  icon: React.ReactNode
  visible: boolean
  order: number
  count?: number
}

interface PersonalMailItemsProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  settings?: PersonalMenuItem[]
  onUpdateSettings: (items: PersonalMenuItem[]) => void
  settingsLoading: boolean
}

const DEFAULT_PERSONAL_ITEMS: PersonalMenuItem[] = [
  {
    id: 'inbox',
    name: 'Inbox',
    icon: <InboxIcon className='size-4' />,
    visible: true,
    order: 0,
    count: 0,
  },
  {
    id: 'drafts',
    name: 'Drafts',
    icon: <FileEdit className='size-4' />,
    visible: true,
    order: 1,
    count: undefined,
  },
  {
    id: 'sent',
    name: 'Sent',
    icon: <Send className='size-4' />,
    visible: true,
    order: 2,
    count: undefined,
  },
]

export function PersonalMailItems({
  isEditMode,
  onToggleEditMode,
  settings,
  onUpdateSettings,
  settingsLoading,
}: PersonalMailItemsProps) {
  const pathname = usePathname()
  const [items, setItems] = useState<PersonalMenuItem[]>(DEFAULT_PERSONAL_ITEMS)

  const inboxCount = useMailCountsStore((s) => s.counts.inbox)
  const draftsCount = useMailCountsStore((s) => s.counts.drafts)
  const isInitialLoading = useMailCountsStore((s) => s.isInitialLoading)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    if (settings) {
      const mergedItems = DEFAULT_PERSONAL_ITEMS.map((defaultItem) => {
        const settingItem = settings.find((s) => s.id === defaultItem.id)
        const baseItem = settingItem ? { ...defaultItem, ...settingItem } : defaultItem

        let count: number | undefined
        if (defaultItem.id === 'inbox') {
          count = inboxCount
        } else if (defaultItem.id === 'drafts') {
          count = draftsCount > 0 ? draftsCount : undefined
        }

        return { ...baseItem, count }
      })

      setItems(mergedItems)
    }
  }, [settings, inboxCount, draftsCount])

  const getItemHref = (item: PersonalMenuItem): string => {
    if (item.id === 'drafts' || item.id === 'sent') {
      return `/app/mail/${item.id}`
    }
    if (item.id === 'inbox') {
      return `/app/mail/${item.id}/open`
    }
    return '/app/mail'
  }

  const toggleItemVisibility = (itemId: string) => {
    if (isEditMode) {
      const updatedItems = items.map((item) =>
        item.id === itemId ? { ...item, visible: !item.visible } : item
      )

      setItems(updatedItems)
      const itemsToSave = updatedItems.map((item) => {
        const { icon, ...itemWithoutIcon } = item
        return itemWithoutIcon
      })
      onUpdateSettings(itemsToSave)
    }
  }

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id) {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrderedItems = arrayMove(items, oldIndex, newIndex)
          const updatedItems = newOrderedItems.map((item, index) => ({
            ...item,
            order: index,
          }))

          setItems(updatedItems)

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

  const visibleItems = isEditMode ? items : items.filter((item) => item.visible)
  const itemIds = items.map((item) => item.id)

  if (settingsLoading || isInitialLoading) {
    return (
      <>
        {Array(3)
          .fill(0)
          .map((_, i) => (
            <SidebarMenuItem key={i}>
              <div className='flex items-center space-x-2 px-2 py-1.5'>
                <Skeleton className='h-4 w-4 rounded-full' />
                <Skeleton className='h-4 w-24' />
              </div>
            </SidebarMenuItem>
          ))}
      </>
    )
  }

  if (isEditMode) {
    return (
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
    )
  }

  return (
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
  )
}
