// apps/web/src/components/pickers/actor-picker/actor-item.tsx

'use client'

import { Check } from 'lucide-react'
import { User, Users } from 'lucide-react'
import { CommandItem } from '@auxx/ui/components/command'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { cn } from '@auxx/ui/lib/utils'
import type { Actor, ActorId } from '@auxx/types/actor'

/**
 * Props for ActorItem display component
 */
export interface ActorItemProps {
  actor: Actor
  isSelected: boolean
  onToggle: (actorId: ActorId) => void
}

/**
 * Single item in the actor picker list.
 * Displays avatar with name and secondary info (email for users, member count for groups).
 */
export function ActorItem({ actor, isSelected, onToggle }: ActorItemProps) {
  const handleSelect = () => {
    onToggle(actor.actorId)
  }

  return (
    <CommandItem
      key={actor.actorId}
      value={actor.actorId}
      onSelect={handleSelect}
      className="flex items-center gap-2">
      <Avatar className="size-6">
        <AvatarImage src={actor.avatarUrl ?? undefined} />
        <AvatarFallback>
          {actor.type === 'user' ? <User className="size-3" /> : <Users className="size-3" />}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-1 flex-col min-w-0">
        <span className="truncate">{actor.name}</span>
        {actor.type === 'user' && actor.email && (
          <span className="text-xs text-muted-foreground truncate">{actor.email}</span>
        )}
        {actor.type === 'group' && actor.memberCount !== undefined && actor.memberCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {actor.memberCount} member{actor.memberCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <Check className={cn('size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
    </CommandItem>
  )
}
