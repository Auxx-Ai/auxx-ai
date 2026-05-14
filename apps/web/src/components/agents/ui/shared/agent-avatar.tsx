// apps/web/src/components/agents/ui/shared/agent-avatar.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { cn } from '@auxx/ui/lib/utils'
import { Bot } from 'lucide-react'
import type { AgentListItem } from '../../store/agent-store'

interface AgentAvatarProps {
  agent: Pick<AgentListItem, 'name' | 'avatarUrl'>
  /** Tailwind size scale — applied as `size-{size}`. Default 8 (32px). */
  size?: 5 | 6 | 7 | 8 | 10 | 12
  className?: string
}

/**
 * Square rounded-xl agent avatar. Falls back to a `<Bot />` icon when the
 * backing user has no avatar. v1 deliberately avoids emoji rendering — that
 * lands in the General-tab follow-up.
 */
export function AgentAvatar({ agent, size = 8, className }: AgentAvatarProps) {
  const initial = (agent.name ?? '?').trim().charAt(0).toUpperCase()
  return (
    <Avatar className={cn(`size-${size}`, 'rounded-xl border', className)}>
      {agent.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt={agent.name ?? ''} /> : null}
      <AvatarFallback className='rounded-xl bg-primary-50 text-primary'>
        {agent.avatarUrl ? initial : <Bot className='size-4' />}
      </AvatarFallback>
    </Avatar>
  )
}
