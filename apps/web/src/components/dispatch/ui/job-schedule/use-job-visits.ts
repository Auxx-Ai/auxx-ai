// apps/web/src/components/dispatch/ui/job-schedule/use-job-visits.ts

'use client'

import { getInstanceId, type RecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import {
  applyVisitToCaches,
  rewrapVisitDates,
  type VisitChangedPayload,
} from '~/components/dispatch/visit-cache'
import { useUser } from '~/hooks/use-user'
import { useOrgChannel } from '~/realtime/hooks'
import { api, type RouterOutputs } from '~/trpc/react'
import type { ExistingVisitForOverlap } from '../schedule-popover'

export type JobVisit = RouterOutputs['dispatch']['listVisits'][number]

/**
 * One work order's visits — the job view Schedule sections' data source
 * (dispatch M2 build spec §F.3). Wraps `dispatch.listVisits`, live realtime
 * invalidation scoped to this work order (`dispatch:visit-changed`, the
 * `use-board-realtime.ts` recipe filtered by `payload.workOrderId`), and the
 * same admin-gated visit mutations the board uses — mutations are admin-only
 * client-side (`useUser().isAdminOrOwner`, the `dispatch-board.tsx` pattern);
 * the server enforces it too (`dispatchAdminProcedure`).
 */
export function useJobVisits(workOrderRecordId: RecordId) {
  const { isAdminOrOwner, userId } = useUser()
  const canEdit = isAdminOrOwner
  const utils = api.useUtils()
  const queryClient = useQueryClient()
  const workOrderInstanceId = getInstanceId(workOrderRecordId)

  const query = api.dispatch.listVisits.useQuery({ workOrderRecordId })
  const visits = useMemo(() => query.data ?? [], [query.data])

  const invalidate = useCallback(() => {
    void utils.dispatch.listVisits.invalidate({ workOrderRecordId })
    // Skip-future / restore-resume / series-end edits change the rule's `until` — keep the
    // series summary + terminator row (plan 36 §B) in step with the visit list.
    void utils.dispatch.getRecurrence.invalidate({ workOrderRecordId })
  }, [utils, workOrderRecordId])

  // Plan 39 §Phase-1 — feed each single-row mutation's own response into `applyVisitToCaches`
  // instead of invalidating `listVisits` (this closes the reported bug: dragging a chip on the
  // board left THIS drawer's Schedule section stale, since the acting tab's own realtime echo
  // is server-suppressed and nothing else was feeding this cache). Patches every cache that can
  // hold the visit (`getBoard`/`listVisits`/`myVisits`), not just this hook's own query.
  const applyResponse = useCallback(
    (visit: RouterOutputs['dispatch']['scheduleVisit']) => {
      applyVisitToCaches(
        { utils, queryClient },
        { visit, workOrderStatus: visit.workOrderStatus, viewerUserId: userId ?? undefined }
      )
    },
    [utils, queryClient, userId]
  )

  // Plan 39 §Phase-2: a `kind: 'row'` broadcast rewraps its wire-string dates and applies
  // through the SAME `applyResponse` a mutation's own success response uses — global-cache-safe
  // and cheap (upsert-by-id), so it's applied unconditionally rather than gated on
  // `workOrderInstanceId` first (`applyVisitToCaches`'s own `listVisits` loop already scopes the
  // write to caches whose `workOrderRecordId` resolves to `visit.workOrderId`). `kind: 'bulk'`
  // (recurrence regeneration, pause/resume, series-end) and any old-shape/malformed payload keep
  // the pre-Phase-2 `workOrderId`-filtered invalidate as the fallback.
  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dispatch:visit-changed') return
      const p = payload as VisitChangedPayload | undefined
      if (p?.kind === 'row' && p.visit) {
        applyResponse({ ...rewrapVisitDates(p.visit), workOrderStatus: p.workOrderStatus })
        return
      }
      if (p?.workOrderId !== workOrderInstanceId) return
      invalidate()
    },
    [workOrderInstanceId, invalidate, applyResponse]
  )
  useOrgChannel({ onEvent })

  const onErrorToast = useCallback(
    (title: string) => (error: { message: string }) =>
      toastError({ title, description: error.message }),
    []
  )

  const scheduleVisit = api.dispatch.scheduleVisit.useMutation({
    onError: onErrorToast('Error scheduling visit'),
    onSuccess: applyResponse,
  })
  const unscheduleVisit = api.dispatch.unscheduleVisit.useMutation({
    onError: onErrorToast('Error unscheduling visit'),
    onSuccess: applyResponse,
  })
  const setVisitStatus = api.dispatch.setVisitStatus.useMutation({
    onError: onErrorToast('Error updating visit status'),
    onSuccess: applyResponse,
  })
  const dispatchVisit = api.dispatch.dispatchVisit.useMutation({
    onError: onErrorToast('Error dispatching visit'),
    onSuccess: applyResponse,
  })
  // Plan 30 §A.5 — bring a canceled/skipped visit back to `scheduled` in place (never a new time).
  // (Add-visit creation lives in `SchedulePopover`'s CREATE mode, not here — the picker commits
  // `dispatch.addVisit` itself.)
  const restoreVisit = api.dispatch.restoreVisit.useMutation({
    onError: onErrorToast('Error restoring visit'),
    onSuccess: (visit, variables) => {
      applyResponse(visit)
      // Plan 36 §A.2 / plan 39 §Phase-1 audit finding: `resumeSeries` also clears the rule
      // pattern's `until` and regenerates the tail — a rule-level write the returned visit row
      // carries no signal of. Keep this one targeted invalidate for that case only; every other
      // restore (`resumeSeries` false/omitted) is fully covered by `applyResponse`.
      // Other tabs (plan 39 §Phase-2): the lib side (`restoreVisit`, `visit-mutations.ts`)
      // publishes a SECOND `kind: 'bulk'` broadcast for this rule-level write — either
      // `materializeVisits`'s own (when it regenerates the tail) or an explicit one (paused
      // engagements, which skip regeneration) — on top of this mutation's `kind: 'row'` one. The
      // `onEvent` bulk-fallback above catches it and invalidates `listVisits`/`getRecurrence`
      // there too, so a resume-series in tab A refreshes both tab B's series summary AND its
      // regenerated visit list. No extra plumbing needed here.
      if (variables.resumeSeries) {
        void utils.dispatch.getRecurrence.invalidate({ workOrderRecordId })
      }
    },
  })
  // "Skip this and future visits" — tombstones the target and ends its series there. Bulk/series
  // op (plan 39 §Phase-1) — a single visit response can't describe the later siblings it also
  // tombstones, so this keeps the full `invalidate` (`listVisits` + `getRecurrence`).
  const cancelVisitFollowing = api.dispatch.cancelVisitFollowing.useMutation({
    onError: onErrorToast('Error skipping visits'),
    onSuccess: invalidate,
  })

  // `SchedulePopoverContent`'s overlap-hint input (07 §D.4) — this job's own
  // other scheduled visits (multi-visit is a planned extension; harmless no-op
  // today since v1 is one visit per work order).
  const existingVisits: ExistingVisitForOverlap[] = useMemo(
    () =>
      visits
        .filter((v): v is JobVisit & { startTime: Date; endTime: Date } =>
          Boolean(v.startTime && v.endTime)
        )
        .map((v) => ({
          id: v.id,
          label: 'this job',
          startTime: v.startTime,
          endTime: v.endTime,
          assigneeUserId: v.assigneeUserId,
        })),
    [visits]
  )

  return {
    visits,
    isLoading: query.isLoading,
    canEdit,
    existingVisits,
    mutations: {
      scheduleVisit,
      unscheduleVisit,
      setVisitStatus,
      dispatchVisit,
      restoreVisit,
      cancelVisitFollowing,
    },
    /** Re-fetch this work order's visits — pair with `SchedulePopover`'s `onScheduled`/
     * `onUnscheduled` callbacks, since that component owns its own mutation (not one of
     * `mutations` above) and the acting tab's own realtime echo is server-suppressed. */
    refresh: invalidate,
  }
}

export type UseJobVisitsResult = ReturnType<typeof useJobVisits>
