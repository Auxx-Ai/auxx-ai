// apps/web/src/components/resources/ui/actor-badge.tsx

'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@auxx/ui/lib/utils'
import { User, Users } from 'lucide-react'

import type { ActorId } from '@auxx/types/actor'
import { parseActorId } from '@auxx/types/actor'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Skeleton } from '@auxx/ui/components/skeleton'

import { useActor } from '~/components/resources/hooks/use-actor'

/**
 * Variants for the ActorBadge component
 */
export const actorBadgeVariants = cva(
  'flex text-sm items-center h-5 gap-1.5 rounded-[5px] ring-1 ps-0.5 pe-1.5 py-0',
  {
    variants: {
      variant: {
        default:
          'cursor-default ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-neutral-800 dark:ring-neutral-800',
        link: 'cursor-pointer ring-transparent hover:ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-neutral-800 dark:ring-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 [&_[data-slot=actor-display]]:underline hover:[&_[data-slot=actor-display]]:no-underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

/**
 * Props for the ActorBadge component.
 */
interface ActorBadgeProps extends VariantProps<typeof actorBadgeVariants> {
  /** ActorId in format "user:userId" or "group:groupId" */
  actorId: ActorId
  /** Whether to show avatar icon (default: true) */
  showIcon?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * A reusable badge component that displays an actor (user or group) with avatar and name.
 * Fetches data using the actor store hooks and shows appropriate loading states.
 *
 * @param actorId - ActorId in format "user:userId" or "group:groupId"
 * @param showIcon - Whether to show avatar (default: true)
 * @param className - Additional CSS classes
 * @param variant - Visual variant (default | link)
 *
 * @example
 * // Basic usage
 * <ActorBadge actorId="user:abc123" />
 *
 * @example
 * // Group actor
 * <ActorBadge actorId="group:xyz789" />
 *
 * @example
 * // Without icon
 * <ActorBadge actorId={actorId} showIcon={false} />
 */
export function ActorBadge({ actorId, showIcon = true, className, variant }: ActorBadgeProps) {
  const { actor, isLoading, isNotFound } = useActor({ actorId })

  // Parse type for fallback icon
  const { type } = parseActorId(actorId)

  // Determine display name
  const displayName = isNotFound ? 'Unknown' : (actor?.name ?? 'Unknown')

  // Show loading state when loading AND no cached data exists
  const showLoading = isLoading && !actor

  return (
    <div
      data-slot="actor-badge"
      aria-busy={showLoading}
      className={cn(actorBadgeVariants({ variant }), className)}>
      {showLoading ? (
        <>
          {showIcon && <Skeleton className="size-4 rounded-full" />}
          <Skeleton className="h-4 w-20 rounded-full" />
        </>
      ) : (
        <>
          {showIcon && (
            <Avatar className="size-4" data-slot="actor-icon">
              <AvatarImage src={actor?.avatarUrl ?? undefined} />
              <AvatarFallback className="text-[10px] bg-neutral-200 dark:bg-neutral-700">
                {type === 'user' ? <User className="size-2.5" /> : <Users className="size-2.5" />}
              </AvatarFallback>
            </Avatar>
          )}
          <span data-slot="actor-display">{displayName}</span>
        </>
      )}
    </div>
  )
}
