// apps/web/src/components/resources/hooks/use-record-access-refresh.ts

'use client'

import type { SubscribeHandlers } from '@auxx/lib/realtime/client'
import { rooms } from '@auxx/lib/realtime/client'
import { useMemo } from 'react'
import { useDehydratedUser } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
import { useRealtimeRoom } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { getRecordStoreState } from '../store/record-store'

/**
 * Keep the `_access` stamp live when a member's access changes.
 *
 * ## Why this exists
 *
 * `_access` is the one field on a cached row that goes stale without the row
 * changing. It is not a property of the record — it is the VIEWER's
 * row-effective rung, folded per query server-side. The record store is the
 * only cache of that fold in the system, and three separate dedupes conspire to
 * make it permanent for a session:
 *
 *  1. `useRecordList` only calls `requestRecord` for ids **not already in the
 *     store**, and `requestRecord` returns early for the same reason.
 *  2. `record.getByIds` is `staleTime: Infinity, refetchOnWindowFocus: false`,
 *     so an identical id set replays the cached response.
 *  3. `capabilities:changed` refetched the capabilities BLOB only.
 *
 * Net effect before this hook: a member granted `edit` on a row saw def-level
 * surfaces update live (nav, New, the request-access trigger — all of which read
 * the blob) while the drawer and the grid stayed read-only until a full page
 * reload, because those read the stamp.
 *
 * ## Why `capabilities:changed` is the right signal
 *
 * `emitResourceAccessInstanceChanged` publishes it **per grantee user room** for
 * an individual grant (`publishCapabilitiesChanged({ userId })`) and to the org
 * room only for a genuine broadcast (workspace baseline, role/group fan-out).
 * So the narrow case — one person shared one row — wakes exactly one client.
 * The same event already covers role, seat and profile changes, all of which
 * move `recordAccessAt` through the seat ceiling or the def rung.
 *
 * ## Cost
 *
 * One batched `record.getByIds` over the rows this client has actually loaded,
 * on an event that fires when someone's permissions change — not on any read
 * path. Rows stay in the store while it is in flight, so nothing blanks and no
 * consumer observes an intermediate `_access: undefined` (which would read as
 * the def rung and flash the wrong affordances).
 *
 * ⚠ The tRPC invalidation is NOT optional. Without it dedupe (2) hands back the
 * pre-grant response and the whole refresh is a no-op that looks like it worked.
 */
export function useRecordAccessRefresh(): void {
  const user = useDehydratedUser()
  const { organizationId } = useOrganizationIdContext()
  const utils = api.useUtils()

  const handlers = useMemo<SubscribeHandlers>(
    () => ({
      onEvent: (event) => {
        if (event !== 'capabilities:changed') return
        // Invalidate BEFORE re-queueing — see the ⚠ above.
        void utils.record.getByIds.invalidate().then(() => {
          getRecordStoreState().requestAccessRefresh()
        })
      },
    }),
    [utils]
  )

  useRealtimeRoom(user ? rooms.user(user.id) : null, handlers)
  useRealtimeRoom(organizationId ? rooms.orgEvents(organizationId) : null, handlers)
}
