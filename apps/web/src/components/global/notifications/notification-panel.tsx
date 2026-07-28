// apps/web/src/components/global/notifications/notification-panel.tsx
'use client'

import type { NotificationType } from '@auxx/database/types'
import type { NotificationEntity } from '@auxx/lib/notifications/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import InfiniteScroll from '@auxx/ui/components/infinite-scroll'
import { InputSearch } from '@auxx/ui/components/input-search'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { Bell, Check, ListFilter, MoreHorizontal, Settings, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useNotifications } from './hooks/use-notifications'
import { type NotificationPanelMode, useNotificationPanelStore } from './notification-panel-store'
import { ApprovalsTab } from './ui/approvals-tab'
import { NotificationItemDispatch } from './ui/notification-item'
import { NotificationRowSkeleton } from './ui/notification-row'

const TYPE_GROUPS: Array<{ label: string; types: NotificationType[] }> = [
  {
    label: 'Mentions & comments',
    types: [
      'COMMENT_MENTION',
      'COMMENT_REPLY',
      'COMMENT_REACTION',
      'TICKET_MENTIONED',
      'THREAD_ACTIVITY',
    ],
  },
  {
    label: 'Tasks',
    types: ['TASK_ASSIGNED', 'TASK_DEADLINE', 'TASK_AUTO_COMPLETED'],
  },
  {
    label: 'Approvals',
    types: [
      'WORKFLOW_APPROVAL_REQUIRED',
      'WORKFLOW_APPROVAL_REMINDER',
      'WORKFLOW_APPROVAL_COMPLETED',
    ],
  },
  {
    label: 'Sharing',
    types: ['RESOURCE_SHARED', 'MESSAGE_SHARED', 'THREAD_SHARED'],
  },
  {
    label: 'Dispatch',
    types: ['WORK_ORDER_DISPATCHED', 'VISIT_RESCHEDULED', 'VISIT_CANCELED', 'VISIT_REASSIGNED'],
  },
  {
    label: 'Tickets & system',
    types: ['TICKET_ASSIGNED', 'TICKET_UPDATED', 'SYSTEM_MESSAGE'],
  },
]

export function NotificationPanel() {
  const open = useNotificationPanelStore((state) => state.open)
  const close = useNotificationPanelStore((state) => state.close)
  // Tab lives in the store — `openApprovals()` (kbar, approval rows) opens the
  // panel straight onto the Approvals tab.
  const mode = useNotificationPanelStore((state) => state.mode)
  const setMode = useNotificationPanelStore((state) => state.setMode)
  const [search, setSearch] = useState('')
  const [types, setTypes] = useState<NotificationType[]>([])
  const viewportRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const isApprovals = mode === 'approvals'

  const {
    notifications,
    debouncedSearch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useNotifications({
    // The notification feed has no bearing on the Approvals tab — stop the query.
    open: open && !isApprovals,
    includeRead: mode === 'all',
    search,
    types,
  })
  const { data: unreadData } = api.notification.getUnreadCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
  })

  // Tab badge = pending workflow confirmations + fresh suggestion bundles. Both
  // run while the panel is open so the badge is right before the tab is clicked.
  const { data: pendingConfirmationCount } = api.approval.getPendingCount.useQuery(undefined, {
    enabled: open,
    refetchOnWindowFocus: true,
  })
  const { data: freshSuggestionData } = api.approvals.count.useQuery(
    { filters: { ownerScope: 'mine_and_unassigned', status: ['FRESH'] } },
    { enabled: open, refetchOnWindowFocus: true }
  )
  const approvalsCount = (pendingConfirmationCount ?? 0) + (freshSuggestionData?.count ?? 0)

  const invalidate = () => {
    void utils.notification.getNotifications.invalidate()
    void utils.notification.getUnreadCount.invalidate()
  }
  const onError = (error: { message: string }) => {
    toastError({ title: 'Error updating notifications', description: error.message })
  }
  const markAsRead = api.notification.markAsRead.useMutation({
    onSuccess: invalidate,
    onError,
  })
  const markAllAsRead = api.notification.markAllAsRead.useMutation({
    onSuccess: invalidate,
    onError,
  })
  const deleteNotification = api.notification.deleteNotifications.useMutation({
    onSuccess: invalidate,
    onError,
  })
  const deleteRead = api.notification.deleteRead.useMutation({
    onSuccess: invalidate,
    onError,
  })
  const deleteAll = api.notification.deleteAll.useMutation({
    onSuccess: invalidate,
    onError,
  })

  const hasFilters = search.length > 0 || types.length > 0
  const toggleType = (type: NotificationType, checked: boolean) => {
    setTypes((current) =>
      checked ? [...new Set([...current, type])] : current.filter((value) => value !== type)
    )
  }

  return (
    <>
      <DrawerHeader
        className='rounded-none'
        icon={<Bell className='size-4' />}
        title='Notifications'
        onClose={close}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-xs' aria-label='Notification actions'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-52'>
              {/* Bulk notification actions are meaningless — and the deletes are
                  actively dangerous — against pending approvals. Hide, never disable. */}
              {isApprovals ? null : (
                <>
                  <DropdownMenuItem
                    disabled={!unreadData?.count || markAllAsRead.isPending}
                    onSelect={() => markAllAsRead.mutate()}>
                    <Check />
                    Mark all as read
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      void confirm({
                        title: 'Delete all read notifications?',
                        description: 'This removes every notification you have already read.',
                        confirmText: 'Delete',
                        cancelText: 'Cancel',
                        destructive: true,
                      }).then((confirmed) => {
                        if (confirmed) deleteRead.mutate()
                      })
                    }}>
                    <Trash2 />
                    Delete all read
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant='destructive'
                    onSelect={() => {
                      void confirm({
                        title: 'Delete all notifications?',
                        description: 'This action cannot be undone.',
                        confirmText: 'Delete',
                        cancelText: 'Cancel',
                        destructive: true,
                      }).then((confirmed) => {
                        if (confirmed) deleteAll.mutate()
                      })
                    }}>
                    <Trash2 />
                    Delete all
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  router.push('/app/settings/general')
                  close()
                }}>
                <Settings />
                Notification settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className='space-y-2 border-b-[0.5px] border-divider-regular p-2'>
        <RadioTab
          value={mode}
          onValueChange={(value) => setMode(value as NotificationPanelMode)}
          size='sm'
          className='w-full border border-primary-200'
          radioGroupClassName='w-full'>
          <RadioTabItem value='all' size='sm' className='gap-1 px-2'>
            All
          </RadioTabItem>
          <RadioTabItem value='unread' size='sm' className='gap-1 px-2'>
            Unread
            {unreadData?.count ? (
              <Badge variant='secondary' className='ml-1 h-5 min-w-5 px-1.5 text-xs'>
                {unreadData.count}
              </Badge>
            ) : null}
          </RadioTabItem>
          <RadioTabItem value='approvals' size='sm' className='gap-1 px-2'>
            Approvals
            {approvalsCount ? (
              <Badge variant='secondary' className='ml-1 h-5 min-w-5 px-1.5 text-xs'>
                {approvalsCount}
              </Badge>
            ) : null}
          </RadioTabItem>
        </RadioTab>
        {isApprovals ? null : (
          <div className='flex items-center gap-2'>
            <InputSearch
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Search notifications'
            />
            <span className='relative shrink-0'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='outline' size='icon-sm' aria-label='Filter notifications'>
                    <ListFilter />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='max-h-[70vh] w-64 overflow-y-auto'>
                  {TYPE_GROUPS.map((group, groupIndex) => (
                    <div key={group.label}>
                      {groupIndex ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                      {group.types.map((type) => (
                        <DropdownMenuCheckboxItem
                          key={type}
                          checked={types.includes(type)}
                          onCheckedChange={(checked) => toggleType(type, checked === true)}
                          onSelect={(event) => event.preventDefault()}>
                          {type
                            .replace(/_/g, ' ')
                            .toLowerCase()
                            .replace(/\b\w/g, (character) => character.toUpperCase())}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {types.length ? (
                <Badge
                  variant='secondary'
                  className='-top-1 -right-1 pointer-events-none absolute h-4 min-w-4 justify-center px-1 text-[10px] leading-none'>
                  {types.length}
                </Badge>
              ) : null}
            </span>
          </div>
        )}
      </div>

      <ScrollArea
        className='min-h-0 flex-1'
        viewportRef={viewportRef}
        viewportClassName='py-2 pb-6'
        scrollbarClassName='w-1'>
        {isApprovals ? (
          <ApprovalsTab viewportRef={viewportRef} />
        ) : isLoading ? (
          <>
            <NotificationRowSkeleton />
            <NotificationRowSkeleton />
            <NotificationRowSkeleton />
          </>
        ) : notifications.length ? (
          <>
            {notifications.map((notification) => (
              <NotificationItemDispatch
                key={notification.id}
                notification={notification as NotificationEntity}
                onRead={(id) => markAsRead.mutate({ notificationIds: [id] })}
                onDelete={(id) => deleteNotification.mutate({ notificationIds: [id] })}
              />
            ))}
            <InfiniteScroll
              isLoading={isFetchingNextPage}
              hasMore={!!hasNextPage}
              next={() => fetchNextPage()}
              root={viewportRef.current}
              rootMargin='200px'>
              <div className='h-px' />
            </InfiniteScroll>
            {isFetchingNextPage ? <NotificationRowSkeleton /> : null}
          </>
        ) : (
          // flex-1 against the ScrollArea content wrapper's `min-h-full flex
          // flex-col`, so the empty state centres in the whole panel rather than
          // in a fixed box pinned to the top.
          <div className='flex flex-1 items-center justify-center'>
            <Empty className='border-0'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Bell />
                </EmptyMedia>
                <EmptyTitle>
                  {hasFilters
                    ? 'No notifications match'
                    : mode === 'unread'
                      ? 'No unread notifications'
                      : 'No notifications yet'}
                </EmptyTitle>
                <EmptyDescription>You're all caught up.</EmptyDescription>
                {hasFilters ? (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      setSearch('')
                      setTypes([])
                    }}>
                    Clear filters
                  </Button>
                ) : null}
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </ScrollArea>
      <ConfirmDialog />
      <span className='sr-only' aria-live='polite'>
        {debouncedSearch ? `Showing results for ${debouncedSearch}` : ''}
      </span>
    </>
  )
}
