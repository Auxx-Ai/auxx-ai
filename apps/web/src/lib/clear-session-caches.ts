// apps/web/src/lib/clear-session-caches.ts

'use client'

import { clearChannelCaches } from '~/components/channels/providers/channel-provider'
import { clearRecordListContext } from '~/components/records/nav/record-list-context-store'
import { clearResourceCaches } from '~/components/resources'

/**
 * Drop every client cache scoped to the signed-in user or their active organization.
 *
 * Call on logout, organization switch, and deletion of the active organization —
 * anything that changes which (user, org) pair the client is looking at.
 *
 * These stores are module singletons, so they survive the client-side navigation
 * those flows perform. Without this the next session in the same tab inherits the
 * previous one's channels, records and personal list overlays.
 */
export function clearSessionCaches(): void {
  clearResourceCaches()
  clearChannelCaches()
  clearRecordListContext()
}
