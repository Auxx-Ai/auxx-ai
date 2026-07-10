// packages/lib/src/dispatch/broadcast.ts
//
// Realtime (07 §B.4) — the `publish-helpers.ts` recipe. Slim ids-only payload; clients
// patch/refetch their board range query (04-ui §D.5) rather than trusting the wire payload.

import { getRealtimeService, rooms } from '../realtime'

/** Slim `dispatch:visit-changed` payload — ids only, clients refetch. */
export interface VisitChangedPayload {
  visitId: string
  workOrderId: string
}

/**
 * Publish `dispatch:visit-changed` on the org presence channel. Echo-suppression
 * convention: tRPC mutations read `x-realtime-socket-id` off the request and pass it as
 * `excludeSocketId`; engine/worker-origin writes omit it so every open tab refreshes.
 * Fire-and-forget — a Pusher hiccup must never fail the underlying visit mutation.
 */
export async function publishVisitChanged(
  organizationId: string,
  payload: VisitChangedPayload,
  options?: { excludeSocketId?: string }
): Promise<void> {
  await getRealtimeService()
    .publish(rooms.orgPresence(organizationId), 'dispatch:visit-changed', payload, options)
    .catch(() => {})
}
