// apps/web/src/components/dashboard/hooks/use-dashboard-draft-realtime.ts

'use client'

import { useCallback, useRef } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { getDashboardDraftState, useDashboardStore } from '../stores/dashboard-draft-store'

/** Payload of the org-channel `dashboard:draft-updated` event (lib `realtime/events.ts`). */
interface DashboardDraftUpdatedPayload {
  dashboardId?: string
  widgetIds?: string[]
  reason?: 'kopilot' | 'system'
}

/**
 * Subscribe the open dashboard to `dashboard:draft-updated`, fired on the org
 * channel after every server-side draft write outside the canvas's own save
 * path (today: Kopilot's draft-edit ops and the turn revert).
 *
 * Signal only. Nothing in the payload is applied directly: the page refetches
 * `dashboard.get` and adopts the result, which is also what refreshes the CAS
 * token `use-dashboard-autosave` sends with its next flush, so a later local
 * edit does not 409 against the agent's work.
 *
 * The refetch goes through `utils.dashboard.get.fetch` on purpose rather than a
 * bare request: it writes the SAME React Query cache entry
 * `use-dashboard-draft-sync` reads, so the fresh `draftLayoutHash` reaches the
 * auto-save hook through the ordinary render path with no cross-hook plumbing.
 *
 * DIRTY CANVAS: the event is ignored. The server-side dirty gate already
 * refuses Kopilot mutations while the chip reports dirty, and a `system` event
 * (a turn revert racing a fresh local edit) must not clobber unsaved work. The
 * next flush wins or conflicts through the CAS, which is the real guard.
 *
 * The publish carries no `excludeSocketId` (the write comes from the server,
 * not another tab), so the editing user's own page receives it. That is the
 * point: they are the primary audience.
 *
 * VIEWERS ARE NOT REFRESHED. `adoptDraft` sets `isEditMode: true`, which flips
 * the store's `selectCurrentDoc` from the published snapshot to the draft, so a
 * read-only member watching someone else's agent work would silently have their
 * canvas swapped for an unpublished document they never asked to see and cannot
 * switch back from (the Live/Draft toggle is not theirs either). Nothing leaks
 * — the canvas stays read-only via the detail view's clamp and `dashboard.get`
 * already ships `draftLayout` to viewers — but a draft write does not change
 * what a viewer's PUBLISHED view renders, so there is nothing for them to
 * refresh in the first place. The guard belongs here rather than in the store:
 * `adoptDraft` is also what the version-restore path uses, where dropping into
 * edit mode is exactly right.
 *
 * Mount once, beside `useDashboardAutosave` in `dashboard-detail-view.tsx`.
 */
export function useDashboardDraftRealtime(dashboardId: string | null, canEdit: boolean): void {
  const adoptDraft = useDashboardStore((s) => s.adoptDraft)
  const utils = api.useUtils()

  // A turn publishes one event per mutation, so events arrive in bursts.
  // Coalesce: one fetch in flight, and a burst member landing mid-fetch queues
  // exactly ONE trailing re-run, so the page ends on the final server state
  // instead of some intermediate one.
  const inflightRef = useRef(false)
  const pendingRef = useRef(false)

  const rehydrate = useCallback(async () => {
    pendingRef.current = true
    if (inflightRef.current) return
    inflightRef.current = true
    try {
      while (pendingRef.current) {
        pendingRef.current = false

        const before = getDashboardDraftState()
        if (!before.dashboardId || before.isDirty) return
        const id = before.dashboardId

        // `staleTime: 0` is load-bearing: the query client's 30s default would
        // let `fetchQuery` answer from cache, and a cached answer is by
        // definition the state this event is telling us has changed.
        const fresh = await utils.dashboard.get.fetch({ id }, { staleTime: 0 })
        if (!fresh) return

        // Re-check AFTER the await: local edits made while the fetch was in
        // flight win, and a dashboard switch makes this response stale.
        const after = getDashboardDraftState()
        if (after.isDirty || after.dashboardId !== id) return

        // `adoptDraft` clones, clears `isDirty` and drops into edit mode, which
        // is the whole seam: no external-update bus, no history plumbing.
        adoptDraft(fresh.draftLayout ?? fresh.layout, fresh.hasUnpublishedChanges)
      }
    } finally {
      inflightRef.current = false
    }
  }, [utils, adoptDraft])

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dashboard:draft-updated') return
      if (!canEdit) return
      const data = (payload ?? {}) as DashboardDraftUpdatedPayload
      if (!dashboardId || data.dashboardId !== dashboardId) return
      const state = getDashboardDraftState()
      if (state.dashboardId !== dashboardId || state.isDirty) return
      void rehydrate()
    },
    [dashboardId, canEdit, rehydrate]
  )

  useOrgChannel({ onEvent })
}
