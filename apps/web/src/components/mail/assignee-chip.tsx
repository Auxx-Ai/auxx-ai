// apps/web/src/components/mail/assignee-chip.tsx
'use client'

import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { UserRound } from 'lucide-react'
import type React from 'react'
import { useActor } from '~/components/resources/hooks'

interface AssigneeChipProps {
  assigneeId: ActorId | null | undefined
  className?: string
  /**
   * When set, the chip becomes the assign trigger. The assign picker anchors to
   * the chip's own DOM node, so the popover opens where the avatar sits.
   */
  onClick?: () => void
}

/**
 * Compact assignee avatar shown inline next to a thread subject in the inbox
 * list. Provider-agnostic — works for chat, email, or any thread with an
 * assignee. Falls back to a placeholder person icon when nothing is assigned.
 */
export function AssigneeChip({ assigneeId, className, onClick }: AssigneeChipProps) {
  const assigneeUserId = (() => {
    if (!assigneeId) return null
    try {
      return parseActorId(assigneeId).id
    } catch {
      return null
    }
  })()

  const { actor: assignee } = useActor({
    actorId: assigneeUserId ? toActorId('user', assigneeUserId) : null,
    enabled: !!assigneeUserId,
  })

  const name = assignee?.name || 'A teammate'
  const initials =
    name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .substring(0, 2) || '?'

  const chip = assigneeUserId ? (
    <Avatar className={cn('size-4 shrink-0', className)}>
      <AvatarImage src={assignee?.avatarUrl || undefined} alt={name} />
      <AvatarFallback className='text-[8px] text-muted-foreground'>{initials}</AvatarFallback>
    </Avatar>
  ) : (
    <UserRound
      className={cn(
        'size-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground',
        className
      )}
    />
  )

  if (!onClick) {
    return (
      <SimpleTooltip content={name} side='right' delayDuration={300}>
        {chip}
      </SimpleTooltip>
    )
  }

  return (
    <SimpleTooltip
      content={assigneeUserId ? name : 'Assign'}
      shortcut='A'
      side='right'
      delayDuration={300}>
      <button
        type='button'
        aria-label={assigneeUserId ? `Assigned to ${name}` : 'Assign'}
        className='flex size-5 items-center justify-center rounded-full hover:bg-accent'
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          onClick()
        }}>
        {chip}
      </button>
    </SimpleTooltip>
  )
}
