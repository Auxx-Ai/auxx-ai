// apps/web/src/components/mail/chat-assignee-chip.tsx
'use client'

import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { useActor } from '~/components/resources/hooks'
import { AvatarWithStatusIcon } from '~/components/users/avatar-with-status-icon'
import { PresenceDot } from '~/components/users/presence-dot'
import { useOrgPresence } from '~/hooks/use-org-presence'
import { api } from '~/trpc/react'

interface ChatAssigneeChipProps {
  assigneeId: ActorId
}

/**
 * Compact assignee chip rendered on chat threads in the inbox list when a
 * teammate (not the current user) is on the chat. Shows the teammate's avatar
 * with the on-duty headset overlay when they're currently flagged on chat
 * duty — same component the handoff banner uses, just sized for a list row.
 *
 * Reads `chatDuty.listOnDuty` via React Query: every chat-thread row in the
 * list shares the same query key, so this is one network call regardless of
 * how many rows mount.
 */
export function ChatAssigneeChip({ assigneeId }: ChatAssigneeChipProps) {
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

  const onDutyQuery = api.chatDuty.listOnDuty.useQuery(undefined, {
    enabled: !!assigneeUserId,
  })
  const assigneeOnDuty = !!assigneeUserId && (onDutyQuery.data ?? []).includes(assigneeUserId)

  const { getState } = useOrgPresence()
  const presence = getState(assigneeUserId)

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
    <span
      className='relative inline-flex shrink-0'
      title={`${name} — ${presence}${assigneeOnDuty ? ' · on chat duty' : ''}`}>
      <AvatarWithStatusIcon
        className='size-5'
        status={assigneeOnDuty ? 'on_duty' : 'none'}
        src={assignee?.image}
        alt={name}
        fallback={initials}
      />
      <PresenceDot
        state={presence}
        hideOffline
        className='absolute -bottom-0.5 -left-0.5 size-1.5'
      />
    </span>
  )
}
