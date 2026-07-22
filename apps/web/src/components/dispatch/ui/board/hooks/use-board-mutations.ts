// apps/web/src/components/dispatch/ui/board/hooks/use-board-mutations.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { applyVisitToCaches } from '~/components/dispatch/visit-cache'
import { parseRecordId, type RecordId } from '~/components/resources'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { useViewerWorkerIds } from '../../shared/use-viewer-worker-ids'
import type { BoardResult, BoardVisit, BoardWorkOrder } from '../types'
import type { DateRange } from './use-board-data'

/** `dispatch.addVisit`'s per-call input, post-coercion — same `unknown`-widening gotcha as
 * `pasteVisits`'s `PasteVisitVars` above (`z.coerce.date()` + the recordId schema cast widen
 * every field to `unknown` on the client-side mutation-variables type). Scoped to this
 * optimistic patch only. */
interface AddVisitVars {
  workOrderRecordId: RecordId
  startTime?: Date
  endTime?: Date
  assigneeWorkerId?: string | null
}

/** `dispatch.createWorkOrder`'s per-call input, post-coercion — same widening gotcha. */
interface CreateWorkOrderVars {
  contactRecordId: RecordId
  title?: string
  startTime: Date
  endTime: Date
  assigneeWorkerId?: string | null
}

/** `dispatch.pasteVisits`'s per-item input, post-coercion — `z.coerce.date()` (and the
 * `recordIdSchema` cast) make the CLIENT-side mutation-variables type widen every field to
 * `unknown` (tRPC infers `.mutate()`'s param type from the schema's pre-parse input, not its
 * parsed output); this is what actually lands in `vars.items` at runtime. `scheduleVisit`'s own
 * `onMutate` above has the identical pre-existing `unknown` gap for the same reason — this cast
 * is scoped to the paste-visits temp-row builder only. */
interface PasteVisitVars {
  workOrderRecordId: RecordId
  startTime: Date
  endTime: Date
  assigneeWorkerId?: string | null
}

/**
 * All visit-mutating writes the board makes, each with an optimistic patch of the
 * `dispatch.getBoard` cache (snapshot → patch → rollback-on-error). Plan
 * `dispatch/39-visit-cache-sync.md` §Phase-1: single-row mutations (`scheduleVisit`,
 * `assignVisit`, `unscheduleVisit`, `setVisitStatus`, `dispatchVisit`, `addVisit`,
 * `createWorkOrder`) reconcile on success via `applyResponse` (`visit-cache.ts`'s
 * `applyVisitToCaches`) instead of invalidating on settle — it patches every cached `getBoard`
 * window (not just this hook's own `range`) plus `listVisits`/`myVisits` if open in this tab, so
 * e.g. a drawer's Schedule section stays in sync with a board drag in the SAME tab. Batch/series
 * ops (`applyToSeries`, `cancelVisitFollowing`, `pasteVisits`) keep the old settle-invalidate —
 * one mutation can touch an unbounded row set, so a single-row response can't describe it.
 * Realtime echo suppression is free (the acting client's socket id travels on the mutation
 * header automatically — `apps/web/src/trpc/react.tsx`), so no extra bookkeeping is needed
 * here beyond the local optimistic patch.
 */
export function useBoardMutations(range: DateRange) {
  const utils = api.useUtils()
  const queryClient = useQueryClient()
  const { organizationId } = useUser()
  const viewerWorkerIds = useViewerWorkerIds()

  // Plan 39 §Phase-1 — the acting tab's single write path: feed every single-row mutation's own
  // response into `applyVisitToCaches` instead of invalidating `getBoard`/`getVisitDayMarkers` on
  // settle. `viewerWorkerIds` (this tab's signed-in user's worker rows) only matters if a
  // `myVisits` cache happens to be open in the same tab — harmless to pass unconditionally.
  const applyResponse = useCallback(
    (
      visit: BoardVisit & { workOrderStatus?: string },
      staleIds?: { removeStaleVisitId?: string; removeStaleWorkOrderId?: string }
    ) => {
      applyVisitToCaches(
        { utils, queryClient },
        {
          visit,
          workOrderStatus: visit.workOrderStatus,
          viewerWorkerIds,
          ...staleIds,
        }
      )
    },
    [utils, queryClient, viewerWorkerIds]
  )

  const patchVisit = useCallback(
    (visitId: string, patch: Partial<BoardVisit>): BoardResult | undefined => {
      const previous = utils.dispatch.getBoard.getData(range)
      if (previous) {
        utils.dispatch.getBoard.setData(range, {
          ...previous,
          visits: previous.visits.map((v) => (v.id === visitId ? { ...v, ...patch } : v)),
        })
      }
      return previous
    },
    [range, utils]
  )

  const rollback = useCallback(
    (previous: BoardResult | undefined) => {
      if (previous) utils.dispatch.getBoard.setData(range, previous)
    },
    [range, utils]
  )

  // Blanket invalidate — kept ONLY for the batch/series mutations below (`applyToSeries`,
  // `cancelVisitFollowing`, `pasteVisits`); every single-row mutation uses `applyResponse`
  // instead (plan 39 §Phase-1).
  const settle = useCallback(() => {
    void utils.dispatch.getBoard.invalidate()
    // v3 sidebar plan §1.4 — keep the mini-calendar's day-marker dots fresh alongside the board.
    void utils.dispatch.getVisitDayMarkers.invalidate()
  }, [range, utils])

  const scheduleVisit = api.dispatch.scheduleVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      const patch: Partial<BoardVisit> = {
        startTime: vars.startTime,
        endTime: vars.endTime,
      }
      const existing = utils.dispatch.getBoard
        .getData(range)
        ?.visits.find((v) => v.id === vars.visitId)
      if (existing?.status === 'canceled') patch.status = 'scheduled'
      if (vars.assigneeWorkerId !== undefined) patch.assigneeWorkerId = vars.assigneeWorkerId
      return { previous: patchVisit(vars.visitId, patch) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error scheduling visit',
        description: error.message,
      })
    },
    onSuccess: (visit) => applyResponse(visit),
  })

  const assignVisit = api.dispatch.assignVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return { previous: patchVisit(vars.visitId, { assigneeWorkerId: vars.assigneeWorkerId }) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error assigning visit',
        description: error.message,
      })
    },
    // No `workOrderStatus` on this response — `assignVisit` has no roll-up rule of its own
    // (`visit-mutations.ts`'s doc comment).
    onSuccess: (visit) => applyResponse(visit),
  })

  const unscheduleVisit = api.dispatch.unscheduleVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return {
        previous: patchVisit(vars.visitId, { startTime: null, endTime: null }),
      }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error unscheduling visit',
        description: error.message,
      })
    },
    onSuccess: (visit) => applyResponse(visit),
  })

  const setVisitStatus = api.dispatch.setVisitStatus.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return { previous: patchVisit(vars.visitId, { status: vars.status }) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error updating visit status',
        description: error.message,
      })
    },
    onSuccess: (visit) => applyResponse(visit),
  })

  const dispatchVisit = api.dispatch.dispatchVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return {
        previous: patchVisit(vars.visitId, { dispatchedAt: new Date() }),
      }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error dispatching visit',
        description: error.message,
      })
    },
    onSuccess: (visit) => applyResponse(visit),
  })

  // Series-wide edits ('following'/'all' scope) touch rows beyond this visit — no optimistic
  // patch (there's nothing local to patch against a whole series); the settle invalidate
  // repaints every affected chip once the write lands.
  const applyToSeries = api.dispatch.applyToSeries.useMutation({
    onError: (error) => {
      toastError({
        title: 'Error updating series',
        description: error.message,
      })
    },
    onSettled: settle,
  })

  // "Skip this and future visits" — the target's own tombstone is patched optimistically; the
  // deleted later siblings sweep away on the settle invalidate (the `applyToSeries` rationale).
  const cancelVisitFollowing = api.dispatch.cancelVisitFollowing.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return { previous: patchVisit(vars.visitId, { status: 'canceled' }) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error skipping visits',
        description: error.message,
      })
    },
    onSettled: settle,
  })

  // Copy/paste's one batch mutation (plan 37c §4.4/§5, item 5) — a single round trip that
  // creates N new rule-less, scheduled visits. Optimistic patch INSERTS temp rows (not the
  // patch-in-place recipe every other mutation above uses) so the pasted chips render
  // instantly; `generateId` (not the server's cuid2) keeps temp ids visually distinct and
  // collision-free until the settle invalidate swaps them for the real rows. No per-item
  // rollback on partial failure — the whole optimistic batch reverts together on a hard
  // error, and the settle invalidate always repaints the true state regardless.
  const pasteVisits = api.dispatch.pasteVisits.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      const previous = utils.dispatch.getBoard.getData(range)
      if (previous) {
        const now = new Date()
        const items = vars.items as PasteVisitVars[]
        const tempVisits: BoardVisit[] = items.map((item) => ({
          id: generateId('temp-visit'),
          organizationId: organizationId ?? '',
          workOrderId: parseRecordId(item.workOrderRecordId).entityInstanceId,
          assigneeWorkerId: item.assigneeWorkerId ?? null,
          startTime: item.startTime,
          endTime: item.endTime,
          timezone: 'UTC',
          status: 'scheduled',
          routeOrder: null,
          latitude: null,
          longitude: null,
          geocodedAt: null,
          dispatchedAt: null,
          timeConfirmedAt: now,
          durationMinutes: Math.round((item.endTime.getTime() - item.startTime.getTime()) / 60_000),
          recurrenceRuleId: null,
          occurrenceDate: null,
          isDetached: false,
          createdAt: now,
          updatedAt: now,
        }))
        utils.dispatch.getBoard.setData(range, {
          ...previous,
          visits: [...previous.visits, ...tempVisits],
        })
      }
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error pasting visits',
        description: error.message,
      })
    },
    onSuccess: (result) => {
      if (result.failures.length > 0) {
        toastError({
          title: 'Some visits could not be pasted',
          description: `${result.failures.length} of ${result.created.length + result.failures.length} visits failed to paste`,
        })
      }
    },
    onSettled: settle,
  })

  // Plan 37c §7, item 2 — slot-click create's "Visit for existing job" path: the existing
  // `dispatch.addVisit` endpoint (unchanged), wrapped with the board's own optimistic temp-row
  // patch (the `pasteVisits` recipe above, singular) so the new visit's chip appears instantly.
  // The target work order already exists in the cache, so (unlike `createWorkOrder` below) no
  // synthetic `BoardWorkOrder` entry is needed — the title/number resolve immediately.
  const addVisit = api.dispatch.addVisit.useMutation({
    onMutate: async (rawVars) => {
      await utils.dispatch.getBoard.cancel(range)
      const vars = rawVars as AddVisitVars
      const previous = utils.dispatch.getBoard.getData(range)
      const tempVisitId = generateId('temp-visit')
      if (previous && vars.startTime && vars.endTime) {
        const now = new Date()
        const tempVisit: BoardVisit = {
          id: tempVisitId,
          organizationId: organizationId ?? '',
          workOrderId: parseRecordId(vars.workOrderRecordId).entityInstanceId,
          assigneeWorkerId: vars.assigneeWorkerId ?? null,
          startTime: vars.startTime,
          endTime: vars.endTime,
          timezone: 'UTC',
          status: 'scheduled',
          routeOrder: null,
          latitude: null,
          longitude: null,
          geocodedAt: null,
          dispatchedAt: null,
          timeConfirmedAt: now,
          durationMinutes: Math.round((vars.endTime.getTime() - vars.startTime.getTime()) / 60_000),
          recurrenceRuleId: null,
          occurrenceDate: null,
          isDetached: false,
          createdAt: now,
          updatedAt: now,
        }
        utils.dispatch.getBoard.setData(range, {
          ...previous,
          visits: [...previous.visits, tempVisit],
        })
      }
      return { previous, tempVisitId }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error adding visit', description: error.message })
    },
    // Response apply also purges the optimistic temp row (`ctx.tempVisitId`) — otherwise the
    // real row lands ALONGSIDE the placeholder instead of replacing it (ids never match).
    onSuccess: (visit, _vars, ctx) =>
      applyResponse(visit, { removeStaleVisitId: ctx?.tempVisitId }),
  })

  // Plan 37c §7, item 1 — slot-click create's "New job" path. Unlike every other board
  // mutation, the work order itself doesn't exist in the cache yet either — the optimistic
  // patch inserts a synthetic `BoardWorkOrder` (client-known title, `number: null`) ALONGSIDE
  // the temp visit row (the `pasteVisits` recipe), so the chip renders the real title instead of
  // `visitToEvent`'s no-work-order fallback for the brief window before the response apply swaps
  // in the real (numbered) work order (plan 39 §Phase-1 — `removeStaleWorkOrderId`/
  // `removeStaleVisitId` purge the placeholders so the real row replaces rather than duplicates).
  const createWorkOrder = api.dispatch.createWorkOrder.useMutation({
    onMutate: async (rawVars) => {
      await utils.dispatch.getBoard.cancel(range)
      const vars = rawVars as CreateWorkOrderVars
      const previous = utils.dispatch.getBoard.getData(range)
      const tempWorkOrderId = generateId('temp-work-order')
      const tempVisitId = generateId('temp-visit')
      if (previous) {
        const now = new Date()
        const tempWorkOrder: BoardWorkOrder = {
          id: tempWorkOrderId,
          displayName: vars.title?.trim() || 'New job',
          number: null,
          status: 'new',
          contactId: vars.contactRecordId,
          contactDisplayName: null,
          addressText: null,
        }
        const tempVisit: BoardVisit = {
          id: tempVisitId,
          organizationId: organizationId ?? '',
          workOrderId: tempWorkOrderId,
          assigneeWorkerId: vars.assigneeWorkerId ?? null,
          startTime: vars.startTime,
          endTime: vars.endTime,
          timezone: 'UTC',
          status: 'scheduled',
          routeOrder: null,
          latitude: null,
          longitude: null,
          geocodedAt: null,
          dispatchedAt: null,
          timeConfirmedAt: now,
          durationMinutes: Math.round((vars.endTime.getTime() - vars.startTime.getTime()) / 60_000),
          recurrenceRuleId: null,
          occurrenceDate: null,
          isDetached: false,
          createdAt: now,
          updatedAt: now,
        }
        utils.dispatch.getBoard.setData(range, {
          ...previous,
          workOrders: [...previous.workOrders, tempWorkOrder],
          visits: [...previous.visits, tempVisit],
        })
      }
      return { previous, tempWorkOrderId, tempVisitId }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error creating work order', description: error.message })
    },
    // Response apply also purges the optimistic temp visit + work order (ids never match the
    // server's real ones) — otherwise they'd land ALONGSIDE the real row instead of replacing it.
    onSuccess: (result, _vars, ctx) =>
      applyResponse(
        { ...result.visit, workOrderStatus: result.workOrderStatus },
        { removeStaleVisitId: ctx?.tempVisitId, removeStaleWorkOrderId: ctx?.tempWorkOrderId }
      ),
  })

  return {
    scheduleVisit,
    assignVisit,
    unscheduleVisit,
    setVisitStatus,
    dispatchVisit,
    applyToSeries,
    cancelVisitFollowing,
    pasteVisits,
    addVisit,
    createWorkOrder,
  }
}
