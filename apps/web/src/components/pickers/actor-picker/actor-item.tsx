// apps/web/src/components/pickers/actor-picker/actor-item.tsx

'use client'

import { Check, Mail } from 'lucide-react'
import { CommandItem } from '@auxx/ui/components/command'
import { Avatar, AvatarImage } from '@auxx/ui/components/avatar'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Badge } from '@auxx/ui/components/badge'
import type { Actor, ActorId } from '@auxx/types/actor'
import { EntityIcon } from '@auxx/ui/components/icons'

/**
 * Props for ActorItem display component
 */
export interface ActorItemProps {
  actor: Actor
  isSelected: boolean
  onToggle: (actorId: ActorId) => void
  /** Multi-select mode shows checkbox, single-select shows styled check */
  multi?: boolean
}

/**
 * Single item in the actor picker list.
 * Shows avatar, name, and badge (member count for groups) or email tooltip icon (for users).
 */
export function ActorItem({ actor, isSelected, onToggle, multi = true }: ActorItemProps) {
  const handleSelect = () => {
    onToggle(actor.actorId)
  }
  const iconId = actor.type === 'user' ? 'user' : 'group'

  return (
    <CommandItem
      key={actor.actorId}
      value={actor.actorId}
      onSelect={handleSelect}
      className="flex items-center gap-2">
      {actor.avatarUrl ? (
        <Avatar className="size-5">
          <AvatarImage src={actor.avatarUrl} />
        </Avatar>
      ) : (
        <EntityIcon
          iconId={iconId}
          color={'gray'}
          size="sm"
          inverse
          className="-ms-0.5 inset-shadow-xs inset-shadow-black/20"
        />
      )}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="truncate">{actor.name}</span>
        {actor.type === 'user' && actor.email && (
          <span title={actor.email}>
            <Mail className="size-3.5 text-muted-foreground shrink-0" />
          </span>
        )}
        {actor.type === 'group' && actor.memberCount !== undefined && actor.memberCount > 0 && (
          <Badge variant="secondary" className="text-xs shrink-0">
            {actor.memberCount}
          </Badge>
        )}
      </div>
      {multi ? (
        <Checkbox checked={isSelected} className="pointer-events-none" />
      ) : (
        isSelected && (
          <div className="rounded-full size-4 bg-info flex items-center justify-center border border-blue-800">
            <Check className="size-2.5! text-white" strokeWidth={4} />
          </div>
        )
      )}
    </CommandItem>
  )
}
