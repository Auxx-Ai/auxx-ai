// apps/web/src/components/mail/thread-event-icon.tsx
'use client'

import type { ThreadEventType } from '@auxx/lib/thread-events/client'
import { cn } from '@auxx/ui/lib/utils'
import {
  BadgeCheck,
  Bot,
  CircleCheck,
  GitMerge,
  RotateCcw,
  Settings,
  Tag,
  UserRound,
  UserRoundCheck,
} from 'lucide-react'

/**
 * Thread-event type → icon/color map for the v2 inline timeline (admin only).
 * Deliberately its OWN mapping — `~/components/timeline/event-icon.tsx` is the
 * record timeline's `TimelineEvent` map and stays bound to that vocabulary; this
 * file is the pattern reference only (plans/threads/thread-events.md §15.7).
 */
export function getThreadEventIcon(type: ThreadEventType) {
  switch (type) {
    case 'thread:taken_over':
      return UserRoundCheck
    case 'thread:returned_to_ai':
      return Bot
    case 'thread:archived':
      return CircleCheck
    case 'thread:reopened':
      return RotateCcw
    case 'thread:assignee:changed':
      return UserRound
    case 'thread:tagged':
    case 'thread:untagged':
      return Tag
    case 'thread:merged':
      return GitMerge
    case 'thread:visitor:identified':
      return BadgeCheck
    default:
      return Settings
  }
}

/** Tailwind text-color classes for the type-icon dot — kept muted/small per §15.3. */
export function getThreadEventColor(type: ThreadEventType): string {
  switch (type) {
    case 'thread:taken_over':
      return 'text-blue-600 dark:text-blue-400'
    case 'thread:returned_to_ai':
      return 'text-violet-600 dark:text-violet-400'
    case 'thread:archived':
      return 'text-good-600 dark:text-good-400'
    case 'thread:reopened':
      return 'text-orange-600 dark:text-orange-400'
    case 'thread:assignee:changed':
      return 'text-comparison-600 dark:text-comparison-400'
    case 'thread:tagged':
      return 'text-indigo-600 dark:text-indigo-400'
    case 'thread:untagged':
      return 'text-muted-foreground'
    case 'thread:merged':
      return 'text-comparison-600 dark:text-comparison-400'
    case 'thread:visitor:identified':
      return 'text-blue-600 dark:text-blue-400'
    default:
      return 'text-muted-foreground'
  }
}

/**
 * The small type-icon dot for one event row — "what happened", never an actor
 * avatar (the avatar lives in the copy, via `ActorBadge`). Sits on the block's
 * shared left rail.
 */
export function ThreadEventDot({ type, className }: { type: ThreadEventType; className?: string }) {
  const Icon = getThreadEventIcon(type)
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full bg-muted',
        getThreadEventColor(type),
        className
      )}>
      <Icon className='size-2.5' />
    </span>
  )
}
