// apps/web/src/components/resources/ui/actor-badge.tsx

'use client'

import type { ActorId } from '@auxx/types/actor'
import { parseActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { Cog, User, Users, X } from 'lucide-react'

import { useActor } from '~/components/resources/hooks/use-actor'

/**
 * Variants for the ActorBadge component
 */
export const actorBadgeVariants = cva(
  'flex items-center rounded-[5px] ring-1 py-0 truncate focus-visible:outline-none',
  {
    variants: {
      variant: {
        default:
          'cursor-default ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-muted dark:ring-primary-100',
        text: 'cursor-default h-4! ring-0 ps-0! pe-0!',
        link: 'cursor-pointer ring-transparent hover:ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-neutral-800 dark:ring-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 [&_[data-slot=actor-display]]:underline hover:[&_[data-slot=actor-display]]:no-underline',
      },
      size: {
        default: [
          'h-5 gap-1.5 ps-0.5 pe-1.5 text-sm',
          '[&_[data-slot=avatar-fallback]]:text-[10px]',
          '[&_[data-slot=actor-fallback-icon]]:size-2.5',
          '[&_[data-slot=skeleton]:first-child]:size-4 [&_[data-slot=skeleton]:first-child]:rounded-full',
          '[&_[data-slot=skeleton]:last-child]:h-4 [&_[data-slot=skeleton]:last-child]:w-20 [&_[data-slot=skeleton]:last-child]:rounded-full',
        ].join(' '),
        sm: [
          'h-4 gap-1 ps-0.5 pe-1 text-xs',
          '[&_[data-slot=avatar-fallback]]:text-[8px]',
          '[&_[data-slot=actor-fallback-icon]]:size-2',
          '[&_[data-slot=skeleton]:first-child]:size-3 [&_[data-slot=skeleton]:first-child]:rounded-full',
          '[&_[data-slot=skeleton]:last-child]:h-3 [&_[data-slot=skeleton]:last-child]:w-14 [&_[data-slot=skeleton]:last-child]:rounded-full',
        ].join(' '),
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

/**
 * Props for the ActorBadge component.
 */
interface ActorBadgeProps extends VariantProps<typeof actorBadgeVariants> {
  /** ActorId in format "user:userId" or "group:groupId" - optional, shows loading when undefined */
  actorId?: ActorId
  /** Whether to show avatar icon (default: true) */
  showIcon?: boolean
  /** Additional CSS classes */
  className?: string
  /** Optional callback to remove this actor. When provided, shows X icon. */
  onRemove?: (actorId: ActorId) => void
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
export function ActorBadge({
  actorId,
  showIcon = true,
  className,
  variant,
  size,
  onRemove,
  ...props
}: ActorBadgeProps) {
  const { actor, isLoading, isNotFound } = useActor({ actorId, enabled: !!actorId })

  // Prefer the resolved actor type (which may be 'system'); fall back to ID prefix during load.
  const type = actor?.type ?? (actorId ? parseActorId(actorId).type : 'user')

  // Determine display name: name → email (for users) → 'Unknown'
  const displayName = isNotFound
    ? 'Unknown'
    : actor?.name || (actor?.type === 'user' && actor?.email) || 'Unknown'

  // Show loading state when actorId is undefined or when loading AND no cached data exists
  const showLoading = !actorId || (isLoading && !actor)

  const avatarSize = size === 'sm' ? 'size-3' : 'size-4'

  return (
    <div
      data-slot='actor-badge'
      aria-busy={showLoading}
      className={cn(actorBadgeVariants({ variant, size }), className)}
      {...props}>
      {showLoading ? (
        <>
          {showIcon && <Skeleton />}
          <Skeleton />
        </>
      ) : (
        <>
          {showIcon && (
            <Avatar className={avatarSize} data-slot='actor-icon'>
              <AvatarImage src={actor?.avatarUrl ?? undefined} />
              <AvatarFallback className='bg-neutral-200 dark:bg-neutral-700'>
                {type === 'system' ? (
                  <Cog data-slot='actor-fallback-icon' />
                ) : type === 'group' ? (
                  <Users data-slot='actor-fallback-icon' />
                ) : (
                  <User data-slot='actor-fallback-icon' />
                )}
              </AvatarFallback>
            </Avatar>
          )}
          <span data-slot='actor-display'>{displayName}</span>
          {onRemove && actorId && (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                onRemove(actorId)
              }}
              className='ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20'
              aria-label={`Remove ${displayName}`}>
              <X className='h-3 w-3' />
            </button>
          )}
        </>
      )}
    </div>
  )
}
