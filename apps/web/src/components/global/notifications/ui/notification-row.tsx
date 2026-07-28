// apps/web/src/components/global/notifications/ui/notification-row.tsx
'use client'

import type { NotificationType } from '@auxx/database/types'
import { DEFAULT_NOTIFICATION_ICON, NOTIFICATION_ICON_MAP } from '@auxx/lib/notifications/client'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { Trash } from 'lucide-react'
import type React from 'react'

interface NotificationRowProps {
  id: string
  isRead: boolean
  createdAt: Date
  type: NotificationType
  /**
   * The composed message line. Each target renderer writes its own sentence here
   * — it is the one place that has both the notification's metadata and the target
   * it resolved, so it can mix in `NotificationActor` / `NotificationRecord` /
   * `Emphasis` chips instead of interpolating names into a string.
   */
  children: React.ReactNode
  /** Secondary line — a comment snippet, an access level, a due date. */
  subtitle?: React.ReactNode
  icon?: React.ReactNode
  onOpen?: () => void
  onDelete: (id: string) => void
  onRead: (id: string) => void
}

function formatNotificationType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

/** Shared notification row presentation used by every target renderer. */
export function NotificationRow({
  id,
  isRead,
  createdAt,
  type,
  children,
  subtitle,
  icon,
  onOpen,
  onDelete,
  onRead,
}: NotificationRowProps) {
  const iconConfig = NOTIFICATION_ICON_MAP[type] ?? DEFAULT_NOTIFICATION_ICON
  const open = () => {
    if (!isRead) onRead(id)
    onOpen?.()
  }

  return (
    <div
      className={cn(
        'group/item mx-2 mb-2 rounded-lg border-[0.5px] border-border shadow-xs last-of-type:mb-0',
        isRead ? 'bg-secondary/20 opacity-80' : 'bg-secondary/30',
        onOpen && 'cursor-pointer hover:bg-secondary/50 hover:ring-1 hover:ring-blue-500'
      )}
      onClick={onOpen ? open : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open()
              }
            }
          : undefined
      }
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}>
      <div className='flex h-9 items-center gap-1.5 rounded-t-lg bg-primary-150/50 px-2 text-muted-foreground text-xs font-medium'>
        {icon ?? <EntityIcon {...iconConfig} size='sm' />}
        <span className='truncate'>{formatNotificationType(type)}</span>
        <span className='ml-auto shrink-0 font-normal'>
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </span>
        {!isRead ? <span className='size-2 shrink-0 rounded-full bg-blue-500' /> : null}
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Delete notification'
          className='shrink-0 opacity-0 hover:bg-destructive/20 hover:text-destructive group-hover/item:opacity-100'
          onClick={(event) => {
            event.stopPropagation()
            onDelete(id)
          }}>
          <Trash />
        </Button>
      </div>
      <div className='rounded-b-lg border-border border-t-[0.5px] px-3 py-2'>
        {/* leading-6 keeps a wrapped message clear of the h-5 chips it may contain. */}
        <p className='text-sm leading-6'>{children}</p>
        {subtitle ? (
          <p className='mt-0.5 line-clamp-2 text-muted-foreground text-xs'>{subtitle}</p>
        ) : null}
      </div>
    </div>
  )
}

export function NotificationRowSkeleton() {
  return (
    <div className='mx-2 mb-2 rounded-lg border-[0.5px] border-border bg-secondary/20 shadow-xs'>
      <div className='flex h-9 items-center gap-1.5 rounded-t-lg bg-primary-150/50 px-2'>
        <Skeleton className='size-4 rounded-full' />
        <Skeleton className='h-3 w-24' />
        <Skeleton className='ml-auto h-3 w-16' />
      </div>
      <div className='rounded-b-lg border-border border-t-[0.5px] px-3 py-2'>
        <Skeleton className='h-4 w-full' />
      </div>
    </div>
  )
}
