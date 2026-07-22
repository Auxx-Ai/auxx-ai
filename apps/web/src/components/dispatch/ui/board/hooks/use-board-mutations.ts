// apps/web/src/components/dispatch/ui/board/hooks/use-board-mutations.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { useCallback } from 'react'
import { parseRecordId, type RecordId } from '~/components/resources'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
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
  assigneeUserId?: string | null
}

/** `dispatch.createWorkOrder`'s per-call input, post-coercion — same widening gotcha. */
interface CreateWorkOrderVars {
  contactRecordId: RecordId
  title?: string
  startTime: Date
  endTime: Date
  assigneeUserId?: string | null
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
  assigneeUserId?: string | null
}

/**
 * All visit-mutating writes the board makes, each with an optimistic patch of the
 * `dispatch.getBoard` cache (snapshot → patch → rollback-on-error → invalidate-on-settle —
 * the `use-task-completion.ts` recipe adapted to `setQueriesData`-style cache surgery).
 * Realtime echo suppression is free (the acting client's socket id travels on the mutation
 * header automatically — `apps/web/src/trpc/react.tsx`), so no extra bookkeeping is needed
 * here beyond the local optimistic patch.
 */
export function useBoardMutations(range: DateRange) {
  const utils = api.useUtils()
  const { organizationId } = useUser()

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
      if (vars.assigneeUserId !== undefined) patch.assigneeUserId = vars.assigneeUserId
      return { previous: patchVisit(vars.visitId, patch) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error scheduling visit',
        description: error.message,
      })
    },
    onSettled: settle,
  })

  const assignVisit = api.dispatch.assignVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getBoard.cancel(range)
      return { previous: patchVisit(vars.visitId, { assigneeUserId: vars.assigneeUserId }) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({
        title: 'Error assigning visit',
        description: error.message,
      })
    },
    onSettled: settle,
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
    onSettled: settle,
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
    onSettled: settle,
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
    onSettled: settle,
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
          assigneeUserId: item.assigneeUserId ?? null,
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
      if (previous && vars.startTime && vars.endTime) {
        const now = new Date()
        const tempVisit: BoardVisit = {
          id: generateId('temp-visit'),
          organizationId: organizationId ?? '',
          workOrderId: parseRecordId(vars.workOrderRecordId).entityInstanceId,
          assigneeUserId: vars.assigneeUserId ?? null,
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
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error adding visit', description: error.message })
    },
    onSettled: settle,
  })

  // Plan 37c §7, item 1 — slot-click create's "New job" path. Unlike every other board
  // mutation, the work order itself doesn't exist in the cache yet either — the optimistic
  // patch inserts a synthetic `BoardWorkOrder` (client-known title, `number: null`) ALONGSIDE
  // the temp visit row (the `pasteVisits` recipe), so the chip renders the real title instead of
  // `visitToEvent`'s no-work-order fallback for the brief window before the settle invalidate
  // swaps in the real (numbered) work order.
  const createWorkOrder = api.dispatch.createWorkOrder.useMutation({
    onMutate: async (rawVars) => {
      await utils.dispatch.getBoard.cancel(range)
      const vars = rawVars as CreateWorkOrderVars
      const previous = utils.dispatch.getBoard.getData(range)
      if (previous) {
        const now = new Date()
        const tempWorkOrderId = generateId('temp-work-order')
        const tempWorkOrder: BoardWorkOrder = {
          id: tempWorkOrderId,
          displayName: vars.title?.trim() || 'New job',
          number: null,
          status: 'new',
          contactId: vars.contactRecordId,
          contactDisplayName: null,
        }
        const tempVisit: BoardVisit = {
          id: generateId('temp-visit'),
          organizationId: organizationId ?? '',
          workOrderId: tempWorkOrderId,
          assigneeUserId: vars.assigneeUserId ?? null,
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
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error creating work order', description: error.message })
    },
    onSettled: settle,
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
