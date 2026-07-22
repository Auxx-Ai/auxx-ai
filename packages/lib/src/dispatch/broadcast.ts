// packages/lib/src/dispatch/broadcast.ts
//
// Realtime (07 §B.4) — the `publish-helpers.ts` recipe. Plan `dispatch/39-visit-cache-sync.md`
// §Phase-2: the payload now carries the composed visit row (+ work-order roll-up status) for
// single-row mutations, so other tabs can surgically patch their caches
// (`apps/web/src/components/dispatch/visit-cache.ts`'s `applyVisitToCaches`) instead of
// refetching a whole list. Bulk/series ops (recurrence regeneration, pause/resume, series-end)
// can't carry a row — they send `kind: 'bulk'` and clients keep invalidating for those.

import type { schema } from '@auxx/database'
import { getRealtimeService, rooms } from '../realtime'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/**
 * `WorkOrderVisit` columns that travel over the realtime wire as ISO strings (Pusher-protocol
 * JSON both directions — no SuperJSON on this channel, unlike tRPC). Every consumer must
 * rewrap these with `new Date(...)` before writing into a React Query cache typed against the
 * SuperJSON'd tRPC row shape. `occurrenceDate` is deliberately NOT in this list — it's a
 * Drizzle `date()` column (mode: default), already a plain `YYYY-MM-DD` string on the row
 * itself server-side, so it needs no rewrap.
 */
type VisitDateKey =
  | 'startTime'
  | 'endTime'
  | 'geocodedAt'
  | 'dispatchedAt'
  | 'timeConfirmedAt'
  | 'createdAt'
  | 'updatedAt'

/** The composed `WorkOrderVisit` row as it travels over the wire — every `VisitDateKey` column
 * downgraded to its ISO-string wire representation (`createdAt`/`updatedAt` are DB `NOT NULL`,
 * so they stay non-null strings; the rest stay nullable). Client-side mirror:
 * `apps/web/src/components/dispatch/visit-cache.ts`'s `SerializedVisitRow` — this module has no
 * `/client` export subpath (server-only deps upstream), so the client copies this type by hand
 * (the `board/types.ts` `VISIT_STATUS_VALUES` precedent) rather than importing it. Keep both in
 * sync by hand if this shape changes. */
export type SerializedVisitRow = Omit<WorkOrderVisitRow, VisitDateKey> & {
  startTime: string | null
  endTime: string | null
  geocodedAt: string | null
  dispatchedAt: string | null
  timeConfirmedAt: string | null
  createdAt: string
  updatedAt: string
}

/** `WorkOrderVisitRow` → `SerializedVisitRow` — the one write side of the wire-date contract
 * above. Used by `afterVisitWrite` (`visit-mutations.ts`) right before publishing. */
export function serializeVisitRow(visit: WorkOrderVisitRow): SerializedVisitRow {
  return {
    ...visit,
    startTime: visit.startTime?.toISOString() ?? null,
    endTime: visit.endTime?.toISOString() ?? null,
    geocodedAt: visit.geocodedAt?.toISOString() ?? null,
    dispatchedAt: visit.dispatchedAt?.toISOString() ?? null,
    timeConfirmedAt: visit.timeConfirmedAt?.toISOString() ?? null,
    createdAt: visit.createdAt.toISOString(),
    updatedAt: visit.updatedAt.toISOString(),
  }
}

/**
 * `dispatch:visit-changed` payload. `visitId`/`workOrderId` are kept at the top level
 * unconditionally (compat: every consumer keys off `workOrderId` today, including `kind:
 * 'bulk'` publishers below that fake `visitId` with a rule id since no single row exists).
 *
 * - `kind: 'row'` — a single-row mutation (`afterVisitWrite`); `visit` carries the composed
 *   value (project rule: a value-less realtime publish is a no-op — always publish the
 *   composed value) and `workOrderStatus` carries the roll-up result when one ran
 *   (`rollUpWorkOrderStatus` — absent for `assignVisit`/`setVisitDuration`, which have no
 *   roll-up rule of their own, and for the recurring-engagement early-return).
 * - `kind: 'bulk'` — recurrence regeneration, pause/resume, series-end, auto-end: ops that can
 *   touch an unbounded row set. No `visit` — clients fall back to their scoped invalidate.
 */
export interface VisitChangedPayload {
  visitId: string
  workOrderId: string
  kind: 'row' | 'bulk'
  visit?: SerializedVisitRow
  workOrderStatus?: string
}

/**
 * Publish `dispatch:visit-changed` on the org presence channel. Echo-suppression
 * convention: tRPC mutations read `x-realtime-socket-id` off the request and pass it as
 * `excludeSocketId`; engine/worker-origin writes omit it so every open tab refreshes.
 * Fire-and-forget — a Pusher hiccup must never fail the underlying visit mutation. Size: one
 * visit row + status is well under the realtime service's payload cap (100KB,
 * docs/realtime-architecture-guide.md).
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
