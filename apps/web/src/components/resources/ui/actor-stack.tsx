// apps/web/src/components/resources/ui/actor-stack.tsx
'use client'

import type { ActorId } from '@auxx/types/actor'
import { parseActorId } from '@auxx/types/actor'
import { cn } from '@auxx/ui/lib/utils'
import { useActor } from '~/components/resources/hooks/use-actor'
import { ActorAvatar } from './actor-badge'

export interface ActorStackProps {
  actorIds: ActorId[]
  /** Max avatars before collapsing into a “+N” chip. Default 5. */
  max?: number
  /** Avatar box size class (applied to each avatar + the overflow chip). Default `size-6`. */
  size?: string
  className?: string
}

/** One resolved avatar (resolves type/avatarUrl from the actor store). */
function StackAvatar({ actorId, size }: { actorId: ActorId; size: string }) {
  const { actor } = useActor({ actorId })
  const type = actor?.type ?? parseActorId(actorId).type
  return (
    <ActorAvatar
      type={type}
      avatarUrl={actor?.avatarUrl}
      className={cn(size, 'ring-2 ring-background')}
    />
  )
}

/**
 * Overlapping stack of actor avatars with a “+N” overflow chip. Presentational
 * layout over {@link ActorAvatar} + {@link useActor}; renders nothing when empty
 * (callers decide the empty copy).
 */
export function ActorStack({ actorIds, max = 5, size = 'size-6', className }: ActorStackProps) {
  if (actorIds.length === 0) return null
  const shown = actorIds.slice(0, max)
  const extra = actorIds.length - shown.length
  return (
    <div className={cn('flex -space-x-1.5', className)}>
      {shown.map((id) => (
        <StackAvatar key={id} actorId={id} size={size} />
      ))}
      {extra > 0 && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full border bg-muted text-[10px] ring-2 ring-background',
            size
          )}>
          +{extra}
        </div>
      )}
    </div>
  )
}
