// ~/components/global/sidebar/personal-mail-group.tsx
'use client'

import { SidebarMenuItem, SidebarMenuSubItem } from '@auxx/ui/components/sidebar'
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
import { FileEdit, Inbox as InboxIcon, Send, Share2, UserCheck, UserRound } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { CollapsibleSidebarSection } from '~/components/global/sidebar/collapsible-sidebar-section'
import { EditableSidebarItem } from '~/components/global/sidebar/editable-sidebar-item'
import { InboxEditMenuItem } from '~/components/global/sidebar/inbox-edit-menu-item'
import type { Inbox } from '~/components/global/sidebar/shared-inbox-group'
import { SidebarNavItem } from '~/components/global/sidebar/sidebar-nav-item'
import { useMailCountsStore } from '~/components/mail/store'

export interface PersonalMenuItem {
  id: string
  name: string
  /**
   * Absent on the persisted copy — a React node can't be serialized into user
   * settings, so it is stripped before every `onUpdateSettings` call and
   * restored from {@link DEFAULT_PERSONAL_ITEMS} when the settings come back.
   */
  icon?: React.ReactNode
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
  /** The current user's personal-channel inboxes (§11) — rendered under Inbox. */
  personalInboxes?: Inbox[]
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
  personalInboxes = [],
}: PersonalMailItemsProps) {
  const pathname = usePathname()
  const [items, setItems] = useState<PersonalMenuItem[]>(DEFAULT_PERSONAL_ITEMS)

  const inboxCount = useMailCountsStore((s) => s.counts.inbox)
  const draftsCount = useMailCountsStore((s) => s.counts.drafts)
  const sharedInboxCounts = useMailCountsStore((s) => s.counts.sharedInboxes)
  const isInitialLoading = useMailCountsStore((s) => s.isInitialLoading)

  // Personal inbox unread arrives under the same `si:{inboxId}` fields as
  // shared inboxes; the Inbox header badge rolls up assigned-to-me + personal.
  const personalUnread = personalInboxes.reduce(
    (sum, inbox) => sum + (sharedInboxCounts[inbox.id] ?? 0),
    0
  )
  const combinedInboxCount = inboxCount + personalUnread

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
          // Inbox is always expandable: assigned/shared entry points are
          // always present, followed by any owned personal inboxes. The
          // header opens the combined personal stream.
          if (item.id === 'inbox') {
            return (
              <CollapsibleSidebarSection
                key={item.id}
                title={item.name}
                icon={item.icon}
                href='/app/mail/inbox/open'
                isEditMode={false}
                defaultOpen
                sectionId='mail.inbox'
                count={combinedInboxCount}
                isActive={!!pathname?.startsWith('/app/mail/inbox/')}>
                <SidebarMenuSubItem>
                  <SidebarNavItem
                    id='assigned'
                    name='Assigned to me'
                    href='/app/mail/assigned/open'
                    icon={<UserCheck className='text-muted-foreground' />}
                    count={inboxCount}
                    isSubmenu
                    isActive={!!pathname?.startsWith('/app/mail/assigned')}
                    onToggleEditMode={onToggleEditMode}
                  />
                </SidebarMenuSubItem>
                <SidebarMenuSubItem>
                  <SidebarNavItem
                    id='shared-with-me'
                    name='Shared with me'
                    href='/app/mail/shared/open'
                    icon={<Share2 className='text-muted-foreground' />}
                    isSubmenu
                    isActive={!!pathname?.startsWith('/app/mail/shared')}
                    onToggleEditMode={onToggleEditMode}
                  />
                </SidebarMenuSubItem>
                {personalInboxes.map((inbox) => (
                  <SidebarMenuSubItem key={inbox.id}>
                    <SidebarNavItem
                      id={inbox.id}
                      name={inbox.name}
                      href={`/app/mail/personal/${inbox.id}/open`}
                      icon={<UserRound className='text-muted-foreground' />}
                      count={sharedInboxCounts[inbox.id] ?? 0}
                      isSubmenu
                      isActive={
                        !!pathname?.startsWith(`/app/mail/personal/${inbox.id}`) &&
                        !pathname?.startsWith(`/app/mail/personal/${inbox.id}/sent`)
                      }
                      // Owner-only list (§11), and provisioning grants the owner
                      // `admin` on their mailbox — so this renders. The gate is
                      // still asked rather than assumed: a claimed or re-granted
                      // inbox answers to its rows like any other.
                      editItems={<InboxEditMenuItem inbox={inbox} />}
                      onToggleEditMode={onToggleEditMode}
                    />
                  </SidebarMenuSubItem>
                ))}
              </CollapsibleSidebarSection>
            )
          }

          // Sent mirrors the Inbox group: header opens the combined sent stream,
          // children are one row per owned personal inbox → that address's sent
          // mail. Sent has no unread badge, so no counts. Flat when the user
          // owns no personal inboxes (falls through to the default item below).
          if (item.id === 'sent' && personalInboxes.length > 0) {
            return (
              <CollapsibleSidebarSection
                key={item.id}
                title={item.name}
                icon={item.icon}
                href='/app/mail/sent'
                isEditMode={false}
                sectionId='mail.sent'
                isActive={
                  pathname === '/app/mail/sent' ||
                  (!!pathname?.startsWith('/app/mail/sent') &&
                    !pathname?.startsWith('/app/mail/personal/'))
                }>
                {personalInboxes.map((inbox) => (
                  <SidebarMenuSubItem key={inbox.id}>
                    <SidebarNavItem
                      id={`${inbox.id}-sent`}
                      name={inbox.name}
                      href={`/app/mail/personal/${inbox.id}/sent`}
                      icon={<UserRound className='text-muted-foreground' />}
                      isSubmenu
                      isActive={!!pathname?.startsWith(`/app/mail/personal/${inbox.id}/sent`)}
                      onToggleEditMode={onToggleEditMode}
                    />
                  </SidebarMenuSubItem>
                ))}
              </CollapsibleSidebarSection>
            )
          }

          const itemHref = getItemHref(item)
          const isActive =
            pathname === itemHref || pathname?.startsWith(itemHref.replace(/\/open$/, '/'))

          return (
            <SidebarMenuItem key={item.id}>
              <SidebarNavItem
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
