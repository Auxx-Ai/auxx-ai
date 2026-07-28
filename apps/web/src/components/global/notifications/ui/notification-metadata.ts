// apps/web/src/components/global/notifications/ui/notification-metadata.ts
'use client'

import type { NotificationEntity, NotificationMetadata } from '@auxx/lib/notifications/client'
import { LENS_LABELS } from '@auxx/lib/permissions/visibility/client'
import { format, isValid, parseISO } from 'date-fns'
import { INSTANCE_SHARE_COPY } from '~/components/permissions/ui/instance-share-copy'

/**
 * The notification's structured copy params, or `null` when there are none to
 * trust. Senders write `metadata.kind` to match the row's `type`; a mismatch means
 * an old row or a sender that has not been wired yet, and the renderer must fall
 * back to the persisted `message`.
 *
 * Switch on the returned `kind` to narrow to a specific metadata shape.
 */
export function notificationMetadata(
  notification: NotificationEntity
): NotificationMetadata | null {
  const metadata = notification.metadata
  return metadata?.kind === notification.type ? metadata : null
}

/** "Due Fri, Aug 1, 2026 at 5:00 PM", or nothing when the deadline is absent/unparseable. */
export function dueLabel(deadline?: string | null): string | undefined {
  if (!deadline) return undefined
  const parsed = parseISO(deadline)
  return isValid(parsed) ? `Due ${format(parsed, 'PPp')}` : undefined
}

/**
 * What an access level means for a shared resource — "Use in search & agents",
 * "Add & manage files", … Reuses the share dialog's copy so there is one source of
 * truth for level semantics.
 */
export function shareLevelLabel(
  resourceKey: keyof typeof INSTANCE_SHARE_COPY,
  level: 'read' | 'write' | 'full'
): string | undefined {
  return INSTANCE_SHARE_COPY[resourceKey]?.levels[level]
}

/** Visibility lens label, matching what `ThreadSharePopover` shows. */
export function lensLabel(lens: string): string | undefined {
  return LENS_LABELS[lens as keyof typeof LENS_LABELS]?.label
}
