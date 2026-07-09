// apps/web/src/components/mail/assignee-chip.tsx
'use client'

import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { useActor } from '~/components/resources/hooks'

interface AssigneeChipProps {
  assigneeId: ActorId
  className?: string
}

/**
 * Compact assignee avatar shown inline next to a thread subject in the inbox
 * list. Provider-agnostic — works for chat, email, or any thread with an
 * assignee.
 */
export function AssigneeChip({ assigneeId, className }: AssigneeChipProps) {
  const assigneeUserId = (() => {
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

  if (!assigneeUserId) return null

  const name = assignee?.name || 'A teammate'
  const initials =
    name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .substring(0, 2) || '?'

  return (
    <SimpleTooltip content={name} side='right' delayDuration={300}>
      <Avatar className={cn('size-4 shrink-0', className)}>
        <AvatarImage src={assignee?.avatarUrl || undefined} alt={name} />
        <AvatarFallback className='text-[8px] text-muted-foreground'>{initials}</AvatarFallback>
      </Avatar>
    </SimpleTooltip>
  )
}
