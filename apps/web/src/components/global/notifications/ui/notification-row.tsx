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
  /**
   * Drives both the unread dot and the read-state dimming. Omit it entirely for
   * rows that have no read state — passing `true` would hide the dot but also dim
   * the card, so the two are bypassed together rather than faked.
   */
  isRead?: boolean
  createdAt: Date
  /** Notification target type — drives the fallback icon and header label. */
  type?: NotificationType
  /** Explicit header label. Wins over the `type`-derived one. */
  label?: React.ReactNode
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
  onDelete?: (id: string) => void
  onRead?: (id: string) => void
  /** Footer buttons, flush right. Rendered outside the clickable body. */
  actions?: React.ReactNode
  /** Sits left of `actions` — hosts an expand toggle or a status line. */
  actionLabel?: React.ReactNode
  /** Detail drawer, rendered below the footer so the actions never move. */
  expanded?: React.ReactNode
}

function formatNotificationType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

/**
 * Shared notification row presentation used by every target renderer.
 *
 * One job per band: the header holds controls only and is never click-through, the
 * body is the open target (a real `<button>` when `onOpen` is passed), and the
 * optional footer and drawer sit outside that click region. The container itself is
 * inert — no `role`, no `onClick` — so no nested control has to stop propagation.
 */
export function NotificationRow({
  id,
  isRead,
  createdAt,
  type,
  label,
  children,
  subtitle,
  icon,
  onOpen,
  onDelete,
  onRead,
  actions,
  actionLabel,
  expanded,
}: NotificationRowProps) {
  const iconConfig = type ? (NOTIFICATION_ICON_MAP[type] ?? DEFAULT_NOTIFICATION_ICON) : null
  const headerLabel = label ?? (type ? formatNotificationType(type) : null)
  const hasFooter = Boolean(actions || actionLabel)

  const open = () => {
    if (isRead === false) onRead?.(id)
    onOpen?.()
  }

  const body = (
    <>
      {/* leading-6 keeps a wrapped message clear of the h-5 chips it may contain. */}
      <p className='text-sm leading-6'>{children}</p>
      {subtitle ? (
        <p className='mt-0.5 line-clamp-2 text-muted-foreground text-xs'>{subtitle}</p>
      ) : null}
    </>
  )

  return (
    <div
      className={cn(
        'group/item mx-2 mb-2 rounded-lg border-[0.5px] border-border shadow-xs last-of-type:mb-0',
        isRead ? 'bg-secondary/20 opacity-80' : 'bg-secondary/30',
        onOpen && 'hover:bg-secondary/50 hover:ring-1 hover:ring-blue-500'
      )}>
      <div className='flex h-9 items-center gap-1.5 rounded-t-lg bg-primary-150/50 px-2 text-muted-foreground text-xs font-medium'>
        {icon ?? (iconConfig ? <EntityIcon {...iconConfig} size='sm' /> : null)}
        {headerLabel ? <span className='truncate'>{headerLabel}</span> : null}
        <span className='ml-auto shrink-0 font-normal'>
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </span>
        {isRead === false ? <span className='size-2 shrink-0 rounded-full bg-blue-500' /> : null}
        {onDelete ? (
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Delete notification'
            className='shrink-0 opacity-0 hover:bg-destructive/20 hover:text-destructive group-hover/item:opacity-100'
            onClick={() => onDelete(id)}>
            <Trash />
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          'rounded-b-lg border-border border-t-[0.5px]',
          (hasFooter || expanded) && 'pb-2'
        )}>
        {onOpen ? (
          // A real button, so the row exposes exactly one focusable control and the
          // header/footer stay outside it. `select-text` keeps the message selectable.
          <button
            type='button'
            onClick={open}
            className='block w-full cursor-pointer select-text rounded-b-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500'>
            {body}
          </button>
        ) : (
          <div className='rounded-b-lg px-3 py-2'>{body}</div>
        )}
        {hasFooter ? (
          <div className='mt-2 flex items-center justify-between gap-2 pl-3 pr-0.5'>
            {actionLabel ?? <span />}
            <div className='flex'>{actions}</div>
          </div>
        ) : null}
        {/* No top margin here: a collapsed animated drawer still mounts (its exit
            spring needs it), so the gap has to come from the drawer's own content
            or every collapsed row carries dead whitespace. */}
        {expanded ? <div className='px-3'>{expanded}</div> : null}
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
