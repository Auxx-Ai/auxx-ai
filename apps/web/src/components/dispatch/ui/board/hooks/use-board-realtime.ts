// apps/web/src/components/dispatch/ui/board/hooks/use-board-realtime.ts

'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
  applyVisitToCaches,
  rewrapVisitDates,
  type VisitChangedPayload,
} from '~/components/dispatch/visit-cache'
import { useUser } from '~/hooks/use-user'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * Live board updates (07 §D.5, the `use-eval-cases-realtime.ts` recipe). Plan
 * `dispatch/39-visit-cache-sync.md` §Phase-2: a `kind: 'row'` broadcast (every single-row
 * mutation) rewraps its wire-string dates and patches every cached `dispatch.getBoard` range
 * via `applyVisitToCaches` instead of invalidating — `applyVisitToCaches` already scoped-
 * invalidates `getVisitDayMarkers` itself, so this never double-invalidates on that path.
 * `kind: 'bulk'` (recurrence regeneration, pause/resume, series-end) and any old-shape/
 * malformed payload fall back to the pre-Phase-2 blanket invalidate. The acting client's own
 * writes are excluded server-side via the `x-realtime-socket-id` header (attached globally by
 * the tRPC client link), so this never double-patches the tab that made the change — only
 * other tabs/users hear it at all.
 */
export function useBoardRealtime() {
  const utils = api.useUtils()
  const queryClient = useQueryClient()
  const { userId } = useUser()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dispatch:visit-changed') return
      const p = payload as VisitChangedPayload | undefined
      if (p?.kind === 'row' && p.visit) {
        applyVisitToCaches(
          { utils, queryClient },
          {
            visit: rewrapVisitDates(p.visit),
            workOrderStatus: p.workOrderStatus,
            viewerUserId: userId ?? undefined,
          }
        )
        return
      }
      void utils.dispatch.getBoard.invalidate()
      // v3 sidebar plan §1.4 — the mini-calendar's day-marker dots follow the same broadcast.
      void utils.dispatch.getVisitDayMarkers.invalidate()
    },
    [utils, queryClient, userId]
  )

  useOrgChannel({ onEvent })
}
