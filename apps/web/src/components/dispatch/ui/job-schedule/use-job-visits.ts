// apps/web/src/components/dispatch/ui/job-schedule/use-job-visits.ts

'use client'

import { getInstanceId, type RecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
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
  const { isAdminOrOwner } = useUser()
  const canEdit = isAdminOrOwner
  const utils = api.useUtils()
  const workOrderInstanceId = getInstanceId(workOrderRecordId)

  const query = api.dispatch.listVisits.useQuery({ workOrderRecordId })
  const visits = useMemo(() => query.data ?? [], [query.data])

  const invalidate = useCallback(() => {
    void utils.dispatch.listVisits.invalidate({ workOrderRecordId })
  }, [utils, workOrderRecordId])

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dispatch:visit-changed') return
      const p = payload as { workOrderId?: string } | undefined
      if (p?.workOrderId !== workOrderInstanceId) return
      invalidate()
    },
    [workOrderInstanceId, invalidate]
  )
  useOrgChannel({ onEvent })

  const onErrorToast = useCallback(
    (title: string) => (error: { message: string }) =>
      toastError({ title, description: error.message }),
    []
  )

  const scheduleVisit = api.dispatch.scheduleVisit.useMutation({
    onError: onErrorToast('Error scheduling visit'),
    onSuccess: invalidate,
  })
  const unscheduleVisit = api.dispatch.unscheduleVisit.useMutation({
    onError: onErrorToast('Error unscheduling visit'),
    onSuccess: invalidate,
  })
  const setVisitStatus = api.dispatch.setVisitStatus.useMutation({
    onError: onErrorToast('Error updating visit status'),
    onSuccess: invalidate,
  })
  const dispatchVisit = api.dispatch.dispatchVisit.useMutation({
    onError: onErrorToast('Error dispatching visit'),
    onSuccess: invalidate,
  })
  // Plan 30 §A.5 — bring a canceled/skipped visit back to `scheduled` in place (never a new time).
  // (Add-visit creation lives in `SchedulePopover`'s CREATE mode, not here — the picker commits
  // `dispatch.addVisit` itself.)
  const restoreVisit = api.dispatch.restoreVisit.useMutation({
    onError: onErrorToast('Error restoring visit'),
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
    },
    /** Re-fetch this work order's visits — pair with `SchedulePopover`'s `onScheduled`/
     * `onUnscheduled` callbacks, since that component owns its own mutation (not one of
     * `mutations` above) and the acting tab's own realtime echo is server-suppressed. */
    refresh: invalidate,
  }
}

export type UseJobVisitsResult = ReturnType<typeof useJobVisits>
