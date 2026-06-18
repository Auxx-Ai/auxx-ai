// apps/web/src/components/kbar/thread-href.ts
'use client'

import type { ThreadMeta } from '~/components/threads/store'

/**
 * Resolve the inbox route that opens a thread, mirroring how the inbox itself
 * selects a thread: the all-inboxes mailbox (`inboxes/all`) at the `all` status
 * shows every thread across all inboxes, and the open thread is carried in the
 * `tid` query param (see `mail-box.tsx`, which reads `?tid=` into the active
 * thread). The thread renders in the right pane regardless of list membership.
 */
export function threadHref(thread: Pick<ThreadMeta, 'id'>): string {
  return `/app/mail/inboxes/all/all?tid=${encodeURIComponent(thread.id)}`
}
