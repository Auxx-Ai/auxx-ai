// apps/web/src/components/global/notifications/ui/notification-chips.tsx
'use client'

import type { NotificationEntity } from '@auxx/lib/notifications/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { toActorId } from '@auxx/types/actor'
import type React from 'react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'

/**
 * Inline chips for the composed notification title (plans/notifications/v2/06-rich-item-copy.md).
 *
 * Nothing here is interactive: the chips render inside `NotificationRow`'s body,
 * which is itself a `<button>` when the row opens something, so a nested link or
 * hover card would be an invalid nested control fighting the row for the click. The
 * chips are a visual treatment only — the row owns navigation.
 *
 * The `inline-flex align-middle` wrappers are load-bearing, not cosmetic: both badge
 * variants start with `flex`, which is a *block* box, and would force a line break
 * mid-sentence inside the title paragraph. `components/timeline/event-description.tsx`
 * wraps for the same reason.
 */

/** Emphasised target name for anything that is not an EntityInstance. */
export function Emphasis({ children }: { children: React.ReactNode }) {
  return <span className='font-medium text-foreground'>{children}</span>
}

/**
 * The actor who triggered the notification, as a badge.
 *
 * `Notification.actorId` references `User.id`, so the ActorId is always `user:<id>`.
 * System-generated rows (approvals, plan overage) have no actorId and fall back to
 * the joined actor name, or to the product name when there is none.
 */
export function NotificationActor({ notification }: { notification: NotificationEntity }) {
  if (!notification.actorId) return <Emphasis>{notification.actor?.name ?? 'Auxx'}</Emphasis>
  return (
    <span className='inline-flex max-w-[12rem] align-middle'>
      <ActorBadge
        actorId={toActorId('user', notification.actorId)}
        variant='link'
        fallbackName={notification.actor?.name ?? undefined}
      />
    </span>
  )
}

/**
 * A target that is a real EntityInstance — resolves its own icon and live name.
 *
 * @param size - `sm` when the chip sits on the smaller subtitle line rather than
 * inside the message sentence.
 */
export function NotificationRecord({
  recordId,
  size,
}: {
  recordId: RecordId
  size?: 'default' | 'sm'
}) {
  return (
    <span className='inline-flex max-w-[14rem] align-middle'>
      <RecordBadge recordId={recordId} size={size} hoverCard={false} />
    </span>
  )
}
