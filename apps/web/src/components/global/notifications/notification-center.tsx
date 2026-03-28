'use client'
import type { NotificationType } from '@auxx/database/types'
import { getPusherClient } from '@auxx/lib/realtime/client'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@auxx/ui/components/sidebar'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { Bell, Check, Mail as MailIcon, Play, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
// components/notifications/notification-center.tsx
import { useEffect, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { HumanConfirmationDialog } from '~/components/workflow/dialogs/human-confirmation-dialog'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

/** Icon config for each notification type */
const NOTIFICATION_ICON_MAP: Record<NotificationType, { iconId: string; color: string }> = {
  COMMENT_MENTION: { iconId: 'user', color: 'blue' },
  COMMENT_REPLY: { iconId: 'message-square', color: 'green' },
  COMMENT_REACTION: { iconId: 'heart', color: 'pink' },
  TICKET_ASSIGNED: { iconId: 'ticket', color: 'indigo' },
  TICKET_UPDATED: { iconId: 'ticket', color: 'teal' },
  TICKET_MENTIONED: { iconId: 'user', color: 'purple' },
  THREAD_ACTIVITY: { iconId: 'message-circle', color: 'teal' },
  SYSTEM_MESSAGE: { iconId: 'info', color: 'gray' },
  WORKFLOW_APPROVAL_REQUIRED: { iconId: 'check-circle', color: 'orange' },
  WORKFLOW_APPROVAL_REMINDER: { iconId: 'bell-ring', color: 'orange' },
  WORKFLOW_APPROVAL_COMPLETED: { iconId: 'check-circle', color: 'green' },
}

/** Default icon config for unmapped notification types */
const DEFAULT_NOTIFICATION_ICON = { iconId: 'bell', color: 'gray' }

/** Format notification type enum to readable label */
const formatNotificationType = (type: string) =>
  type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())

// Helper to determine notification link based on entity type
const getNotificationLink = (entityType: string, entityId: string) => {
  switch (entityType) {
    case 'Comment':
      return `/app/comments/${entityId}`
    case 'Ticket':
      return `/app/tickets/${entityId}`
    case 'Thread':
      return `/app/threads/${entityId}`
    case 'approval_request':
      return null // Handle via dialog instead
    default:
      return '#'
  }
}
// Notification item component
const NotificationItem = ({
  notification,
  onRead,
  onDelete,
  onOpenApprovalDialog,
}: {
  notification: any
  onRead: (id: string) => void
  onDelete: (id: string) => void
  onOpenApprovalDialog?: (approvalId: string) => void
}) => {
  const router = useRouter()
  const { id, type, message, entityType, entityId, createdAt, isRead, actor } = notification
  const handleClick = () => {
    if (!isRead) {
      onRead(id)
    }
    // Handle approval request notifications differently
    if (entityType === 'approval_request' && onOpenApprovalDialog) {
      onOpenApprovalDialog(entityId)
      return
    }
    const link = getNotificationLink(entityType, entityId)
    if (link) {
      router.push(link)
    }
  }
  const iconConfig = NOTIFICATION_ICON_MAP[type as NotificationType] ?? DEFAULT_NOTIFICATION_ICON

  return (
    <div
      className={cn(
        'group/item mx-2 mb-2 rounded-lg border-[0.5px] border-border shadow-xs last-of-type:mb-0',
        'cursor-pointer hover:bg-secondary/50 hover:ring-1 hover:ring-blue-500',
        isRead ? 'bg-secondary/20 opacity-80' : 'bg-secondary/30'
      )}
      onClick={handleClick}>
      {/* Header bar */}
      <div className='flex h-9 items-center px-2 text-xs font-medium text-muted-foreground bg-primary-150/50 rounded-t-lg'>
        <EntityIcon {...iconConfig} size='sm' className='mr-1.5' />
        <span className='grow truncate'>{formatNotificationType(type)}</span>
        {!isRead && <span className='size-2 rounded-full bg-blue-500 shrink-0' />}
      </div>

      {/* Body */}
      <div className='px-3 py-2 border-t-[0.5px] border-border'>
        <p className='text-sm'>{message}</p>
      </div>

      {/* Footer */}
      <div className='flex items-center px-3 py-1.5 border-t-[0.5px] border-border rounded-b-lg'>
        {actor && (
          <div className='mr-2 flex items-center'>
            <Avatar className='mr-1 size-4'>
              {actor.image ? (
                <AvatarImage src={actor.image} alt={actor.name || ''} />
              ) : (
                <AvatarFallback className='text-[9px]'>
                  {actor.name?.charAt(0) || '?'}
                </AvatarFallback>
              )}
            </Avatar>
            <span className='text-xs text-muted-foreground'>{actor.name}</span>
          </div>
        )}
        <span className='text-xs text-muted-foreground grow'>
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </span>
        <Button
          variant='ghost'
          size='icon-sm'
          className='shrink-0 opacity-0 group-hover/item:opacity-100 hover:bg-destructive/20 hover:text-destructive'
          onClick={(e) => {
            e.stopPropagation()
            onDelete(id)
          }}>
          <Trash />
        </Button>
      </div>
    </div>
  )
}
// Loading skeleton for notifications
const NotificationSkeleton = () => (
  <div className='mx-2 mb-2 rounded-lg border-[0.5px] border-border bg-secondary/20 shadow-xs'>
    <div className='flex h-9 items-center px-2 bg-primary-150/50 rounded-t-lg'>
      <Skeleton className='size-4 rounded-full mr-1.5' />
      <Skeleton className='h-3 w-24' />
    </div>
    <div className='px-3 py-2 border-t-[0.5px] border-border'>
      <Skeleton className='h-4 w-full' />
    </div>
    <div className='flex items-center px-3 py-1.5 border-t-[0.5px] border-border'>
      <Skeleton className='size-4 rounded-full mr-1' />
      <Skeleton className='h-3 w-20' />
    </div>
  </div>
)
// Main notification center component
export const NotificationCenter = () => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('all')
  const [humanConfirmationDialog, setHumanConfirmationDialog] = useState({
    open: false,
    selectedApprovalId: undefined as string | undefined,
  })
  // Mock pending actions count - replace with actual API call when available
  const pendingActionsCount = 3
  // Get notifications
  const {
    data,
    isLoading,
    refetch: refreshNotifications,
  } = api.notification.getNotifications.useQuery(
    { includeRead: mode === 'all', limit: 10 },
    {
      enabled: open, // Only fetch when popover is open
      refetchOnWindowFocus: false,
    }
  )

  // Get unread count
  const { data: unreadData, refetch: refreshUnreadCount } =
    api.notification.getUnreadCount.useQuery(undefined, {
      refetchOnWindowFocus: true,
      // refetchInterval: 60000, // Refresh every minute
    })
  // Mutation to mark notifications as read
  const markAsRead = api.notification.markAsRead.useMutation({
    onSuccess: () => {
      refreshNotifications()
      refreshUnreadCount()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })
  // Mutation to mark all notifications as read
  const markAllAsRead = api.notification.markAllAsRead.useMutation({
    onSuccess: () => {
      refreshNotifications()
      refreshUnreadCount()
      toastSuccess({ description: 'All notifications marked as read' })
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })
  // Mutation to delete notifications
  const deleteNotification = api.notification.deleteNotifications.useMutation({
    onSuccess: () => {
      refreshNotifications()
      refreshUnreadCount()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })
  // Handle marking a notification as read
  const handleMarkAsRead = (id: string) => {
    markAsRead.mutate({ notificationIds: [id] })
  }
  // Handle marking all notifications as read
  const handleMarkAllAsRead = () => {
    markAllAsRead.mutate()
  }
  // Handle deleting a notification
  const handleDelete = (id: string) => {
    deleteNotification.mutate({ notificationIds: [id] })
  }
  // Handle mode change
  const handleModeChange = (newMode: string) => {
    setMode(newMode)
  }
  // Handle opening human confirmation dialog
  const openHumanConfirmationDialog = (approvalId: string) => {
    setHumanConfirmationDialog({ open: true, selectedApprovalId: approvalId })
    setOpen(false) // Close notification popover
  }
  // Close popover when navigating away
  useEffect(() => {
    const handleRouteChange = () => {
      setOpen(false)
    }
    window.addEventListener('popstate', handleRouteChange)
    return () => {
      window.removeEventListener('popstate', handleRouteChange)
    }
  }, [])
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip='Notifications'>
              <Bell />
              <span>Notifications</span>
            </SidebarMenuButton>
            {unreadData?.count && unreadData.count > 0 ? (
              <SidebarMenuBadge>
                {unreadData.count > 99 ? '99+' : unreadData.count}
              </SidebarMenuBadge>
            ) : null}
          </SidebarMenuItem>

          {/* <Button
          size="icon"
          className="size-9 relative rounded-full duration-300 animate-in zoom-in ">
          <Bell className="h-5 w-5" />
          {unreadData?.count && unreadData.count > 0 ? (
            <Badge className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center bg-red-500 p-0">
              {unreadData.count > 99 ? '99+' : unreadData.count}
            </Badge>
          ) : null}
        </Button> sideOffset={-36} */}
        </PopoverTrigger>
        <PopoverContent
          className='w-110 mr-4 p-0 min-h-[300px] backdrop-blur-sm bg-white/40 dark:bg-white/5'
          align='start'>
          <div className='flex items-center justify-between px-3 py-2 border-b sticky top-0 backdrop-blur-sm dark:bg-black/40 bg-white/40 z-1'>
            <div className='font-medium text-sm'>Notifications</div>
            {unreadData && unreadData?.count > 0 && (
              <Button
                variant='ghost'
                size='sm'
                onClick={handleMarkAllAsRead}
                loading={markAllAsRead.isPending || isLoading}
                loadingText='Marking...'
                disabled={isLoading || markAllAsRead.isPending}>
                <Check />
                Mark all read
              </Button>
            )}
          </div>

          <div className='p-2 pt-0'>
            <RadioTab
              value={mode}
              onValueChange={setMode}
              size='sm'
              radioGroupClassName='grid w-full'
              className='border border-primary-200 flex flex-1 w-full'>
              <RadioTabItem value='all' size='sm'>
                <MailIcon />
                All
              </RadioTabItem>
              <RadioTabItem value='unread' size='sm'>
                <Play />
                Unread
                {unreadData?.count && unreadData.count > 0 ? (
                  <Badge variant='secondary' className='ml-2 h-5 min-w-[20px] px-1.5 text-xs'>
                    {unreadData.count}
                  </Badge>
                ) : null}
              </RadioTabItem>
            </RadioTab>
          </div>

          <div className='flex flex-col m-0 flex-1'>
            {isLoading ? (
              <div className='max-h-96 overflow-y-auto py-2'>
                <NotificationSkeleton />
                <NotificationSkeleton />
                <NotificationSkeleton />
              </div>
            ) : mode === 'all' ? (
              data?.notifications.length === 0 ? (
                <div className='flex flex-1 items-center justify-center'>
                  <EmptyState
                    icon={Bell}
                    title='No notifications yet'
                    className='py-8'
                    iconClassName='h-8 w-8'
                  />
                </div>
              ) : (
                <div className='max-h-96 overflow-y-auto py-2'>
                  {data?.notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id!}
                      notification={notification}
                      onRead={handleMarkAsRead}
                      onDelete={handleDelete}
                      onOpenApprovalDialog={openHumanConfirmationDialog}
                    />
                  ))}
                </div>
              )
            ) : mode === 'unread' ? (
              data?.notifications.filter((n) => !n.isRead).length === 0 ? (
                <div className='flex flex-1 items-center justify-center'>
                  <EmptyState
                    icon={Bell}
                    title='No unread notifications'
                    className='py-8'
                    iconClassName='h-8 w-8'
                  />
                </div>
              ) : (
                <div className='max-h-96 overflow-y-auto py-2'>
                  {data?.notifications
                    .filter((notification) => !notification.isRead)
                    .map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onRead={handleMarkAsRead}
                        onDelete={handleDelete}
                        onOpenApprovalDialog={openHumanConfirmationDialog}
                      />
                    ))}
                </div>
              )
            ) : null}

            {data?.totalCount && data.totalCount > 10 ? (
              <div className='p-2 text-center'>
                <Button
                  variant='link'
                  size='sm'
                  onClick={() => {
                    // Navigate to full notifications page
                    router.push(`/app/notifications`)
                    setOpen(false)
                  }}>
                  View all {data.totalCount} notifications
                </Button>
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      {/* Human Confirmation Dialog */}
      <HumanConfirmationDialog
        open={humanConfirmationDialog.open}
        onOpenChange={(open) => setHumanConfirmationDialog((prev) => ({ ...prev, open }))}
        selectedApprovalId={humanConfirmationDialog.selectedApprovalId}
      />
    </>
  )
}
export function useNotificationSubscription(userId: string) {
  const utils = api.useUtils()
  const { pusher: pusherEnv } = useEnv()
  useEffect(() => {
    const pusher = getPusherClient(pusherEnv.key, pusherEnv.cluster)
    if (!pusher) return
    const channel = pusher.subscribe(`private-user-${userId}`)
    channel.bind('notification', () => {
      // Invalidate notifications query to refresh the data
      utils.notification.getNotifications.invalidate()
      utils.notification.getUnreadCount.invalidate()
    })
    return () => {
      channel.unbind_all()
      pusher.unsubscribe(`private-user-${userId}`)
    }
  }, [userId, utils, pusherEnv.key, pusherEnv.cluster])
}
