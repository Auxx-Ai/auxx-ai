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
import { Bell, Check, ListFilter, Mail, MoreHorizontal, Play, Settings, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useNotifications } from './hooks/use-notifications'
import { useNotificationPanelStore } from './notification-panel-store'
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

interface NotificationPanelProps {
  onOpenApproval: (approvalRequestId: string) => void
}

export function NotificationPanel({ onOpenApproval }: NotificationPanelProps) {
  const open = useNotificationPanelStore((state) => state.open)
  const close = useNotificationPanelStore((state) => state.close)
  const [mode, setMode] = useState<'all' | 'unread'>('all')
  const [search, setSearch] = useState('')
  const [types, setTypes] = useState<NotificationType[]>([])
  const viewportRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const {
    notifications,
    debouncedSearch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useNotifications({
    open,
    includeRead: mode === 'all',
    search,
    types,
  })
  const { data: unreadData } = api.notification.getUnreadCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
  })

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
        <InputSearch
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder='Search notifications'
        />
        <div className='flex items-center justify-between gap-2'>
          <RadioTab
            value={mode}
            onValueChange={(value) => setMode(value as 'all' | 'unread')}
            size='sm'
            className='border border-primary-200'>
            <RadioTabItem value='all' size='sm'>
              <Mail />
              All
            </RadioTabItem>
            <RadioTabItem value='unread' size='sm'>
              <Play />
              Unread
              {unreadData?.count ? (
                <Badge variant='secondary' className='ml-1 h-5 min-w-5 px-1.5 text-xs'>
                  {unreadData.count}
                </Badge>
              ) : null}
            </RadioTabItem>
          </RadioTab>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='sm'>
                <ListFilter />
                Filter
                {types.length ? <Badge variant='secondary'>{types.length}</Badge> : null}
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
        </div>
      </div>

      <ScrollArea
        className='min-h-0 flex-1'
        viewportRef={viewportRef}
        viewportClassName='py-2 pb-6'
        scrollbarClassName='w-1'>
        {isLoading ? (
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
                onOpenApproval={onOpenApproval}
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
          <div className='flex min-h-[320px] items-center justify-center'>
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
