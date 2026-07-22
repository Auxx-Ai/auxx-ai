// apps/web/src/components/dispatch/visit-cache.ts
//
// Plan `dispatch/39-visit-cache-sync.md` §Phase-1 — the one write path that patches every
// visit-holding React Query cache from a mutation response (Phase 2 reuses it for a fattened
// realtime payload). Board chip drag → work-order drawer Schedule section going stale in the
// SAME tab was the reported bug; this closes it by feeding `applyVisitToCaches` off each
// single-row mutation's own response instead of invalidating/refetching a list.
//
// Pure per-cache patch functions are exported standalone (no React Query import) so
// `visit-cache.test.ts` can exercise the window/merge/sort logic without a QueryClient.
//
// §Phase-2 — `VisitChangedPayload`/`SerializedVisitRow` below are a hand-copied CLIENT mirror of
// `packages/lib/src/dispatch/broadcast.ts`'s types (the `board/types.ts` `VISIT_STATUS_VALUES`
// precedent): that lib module has no `/client` export subpath (server-only deps upstream), so
// importing the real type would pull the whole server barrel into client code (the CLAUDE.md
// client/server import rule). Keep both copies in sync by hand if the wire shape changes.

import { getInstanceId, type RecordId } from '@auxx/types/resource'
import type { QueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { api, type RouterOutputs } from '~/trpc/react'
import type { BoardResult, BoardVisit, BoardWorkOrder } from './ui/board/types'
import type { JobVisit } from './ui/job-schedule/use-job-visits'

type MyVisitRow = RouterOutputs['dispatch']['myVisits'][number]

// ════════════════════════════════════════════════════════════════════════════
// Realtime wire shape — client mirror of `packages/lib/src/dispatch/broadcast.ts` (see the
// file-header note on why this is hand-copied, not imported).
// ════════════════════════════════════════════════════════════════════════════

/** `WorkOrderVisit` date columns that arrive as ISO strings on the realtime wire (Pusher-
 * protocol JSON, no SuperJSON on this channel) — mirrors `broadcast.ts`'s `VisitDateKey`.
 * `occurrenceDate` is deliberately NOT here: it's a Drizzle `date()` column, already a plain
 * `YYYY-MM-DD` string on `BoardVisit` itself. */
type VisitDateKey =
  | 'startTime'
  | 'endTime'
  | 'geocodedAt'
  | 'dispatchedAt'
  | 'timeConfirmedAt'
  | 'createdAt'
  | 'updatedAt'

/** The composed `WorkOrderVisit` row as it travels over the wire — every `VisitDateKey` field
 * downgraded to its ISO-string wire representation (`createdAt`/`updatedAt` are DB `NOT NULL`,
 * so they stay non-null strings; the rest stay nullable). Mirrors `broadcast.ts`'s
 * `SerializedVisitRow`, defined against `BoardVisit` instead of the server row type. */
export type SerializedVisitRow = Omit<BoardVisit, VisitDateKey> & {
  startTime: string | null
  endTime: string | null
  geocodedAt: string | null
  dispatchedAt: string | null
  timeConfirmedAt: string | null
  createdAt: string
  updatedAt: string
}

/** `dispatch:visit-changed` payload — client mirror of `broadcast.ts`'s `VisitChangedPayload`.
 * `kind: 'row'` carries the composed value (`visit`, dates as wire strings) plus whatever
 * roll-up ran (`workOrderStatus`); `kind: 'bulk'` (recurrence regeneration, pause/resume,
 * series-end) and any old-shape/malformed payload carry neither — realtime handlers fall back
 * to their pre-Phase-2 scoped invalidate in that case. */
export interface VisitChangedPayload {
  visitId: string
  workOrderId: string
  kind: 'row' | 'bulk'
  visit?: SerializedVisitRow
  workOrderStatus?: string
}

/** `SerializedVisitRow` → `BoardVisit` — rewrap every wire-string date field back to a real
 * `Date` (nulls stay null) before handing a realtime payload's row to `applyVisitToCaches`,
 * which is typed (and tested) against the SuperJSON'd `BoardVisit` shape every other cache
 * write already uses. */
export function rewrapVisitDates(row: SerializedVisitRow): BoardVisit {
  return {
    ...row,
    startTime: row.startTime ? new Date(row.startTime) : null,
    endTime: row.endTime ? new Date(row.endTime) : null,
    geocodedAt: row.geocodedAt ? new Date(row.geocodedAt) : null,
    dispatchedAt: row.dispatchedAt ? new Date(row.dispatchedAt) : null,
    timeConfirmedAt: row.timeConfirmedAt ? new Date(row.timeConfirmedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  } as BoardVisit
}

/** A cache window — `getBoard`/`myVisits` are both keyed `{from, to}`. */
export interface VisitWindow {
  from: Date
  to: Date
}

/**
 * `visit.startTime` falling inside `window` is the client-side proxy for "this cache's window
 * should show this visit" — `null` (unscheduled/backlog) is never in-window. Mirrors the
 * inclusive `gte(endTime, from) && lte(startTime, to)` overlap `getBoard` itself queries with,
 * approximated to a startTime-only check (visits run hours, never window-length, so the
 * approximation never disagrees with the server in practice); `myVisits`/`getVisitDayMarkers`
 * query `[from, to)` server-side, which this errs inclusive of at the `to` edge — a chip stays
 * visible one patch past its true boundary until the next real fetch corrects it, harmless.
 */
export function isScheduledWithinWindow(
  startTime: Date | null | undefined,
  window: VisitWindow
): boolean {
  if (!startTime) return false
  const t = startTime.getTime()
  return t >= window.from.getTime() && t <= window.to.getTime()
}

/** Sort ascending by `startTime`, nulls last — the `listVisits`/`getBoard` server convention
 * (`ORDER BY startTime ASC NULLS LAST`). */
export function sortByStartTimeAscNullsLast<T extends { startTime: Date | null }>(
  rows: readonly T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (a.startTime === null) return b.startTime === null ? 0 : 1
    if (b.startTime === null) return -1
    return a.startTime.getTime() - b.startTime.getTime()
  })
}

// ════════════════════════════════════════════════════════════════════════════
// getBoard — every cached fetch window (day/timeline scrolling keeps many alive at once).
// ════════════════════════════════════════════════════════════════════════════

/** Upsert-or-remove `visit` in one window's cached `visits[]` — in-window → replace (existing
 * id) or append (new id); out-of-window → drop it. Covers both "moved out of range" and
 * "unscheduled back to the backlog rail" (backlog visits have `startTime: null`, which is never
 * in-window for any real window, so an unscheduled visit simply falls out everywhere it used to
 * render). */
export function patchBoardVisits(
  visits: readonly BoardVisit[],
  visit: BoardVisit,
  window: VisitWindow
): BoardVisit[] {
  const inWindow = isScheduledWithinWindow(visit.startTime, window)
  const exists = visits.some((v) => v.id === visit.id)

  if (inWindow) {
    return exists ? visits.map((v) => (v.id === visit.id ? visit : v)) : [...visits, visit]
  }
  return exists ? visits.filter((v) => v.id !== visit.id) : [...visits]
}

export interface BoardPatchResult {
  board: BoardResult
  /** The visit belongs in this window but its work order has never been seen there — a
   * `BoardWorkOrder` summary (title/number/contact) can't be fabricated client-side, it's a
   * server-side `FieldValue` read. The caller falls back to a scoped `getBoard.invalidate` for
   * just this one window. */
  needsInvalidate: boolean
}

/** One cached `getBoard` window's patch — `visits[]` always gets the upsert/remove treatment;
 * `workOrders[]` only when the visit's own work order is already known there (an existing job;
 * `workOrderStatus` patches its `status` in place). */
export function applyBoardPatch(
  board: BoardResult,
  visit: BoardVisit,
  workOrderStatus: string | undefined,
  window: VisitWindow
): BoardPatchResult {
  const visits = patchBoardVisits(board.visits, visit, window)

  if (!isScheduledWithinWindow(visit.startTime, window)) {
    return { board: { ...board, visits }, needsInvalidate: false }
  }

  const hasWorkOrder = board.workOrders.some((wo) => wo.id === visit.workOrderId)
  if (!hasWorkOrder) {
    return { board: { ...board, visits }, needsInvalidate: true }
  }

  const workOrders: BoardWorkOrder[] =
    workOrderStatus === undefined
      ? board.workOrders
      : board.workOrders.map((wo) =>
          wo.id === visit.workOrderId ? { ...wo, status: workOrderStatus } : wo
        )

  return { board: { ...board, visits, workOrders }, needsInvalidate: false }
}

// ════════════════════════════════════════════════════════════════════════════
// listVisits — one work order's Schedule section, keyed `{workOrderRecordId}`.
// ════════════════════════════════════════════════════════════════════════════

/** Merge-by-id into a `listVisits` cache, preserving the invoice-allocation enrichment fields
 * the router joins in (`invoiceState`/`invoiceCount`/`invoiceId` — never present on the raw
 * mutation-response row): the existing row spreads first, the changed scalar fields overwrite on
 * top, so enrichment survives untouched. A new id (e.g. `addVisit`) inserts at the enrichment's
 * zero-state (`uninvoiced`, count 0) — a brand-new row can't have been invoiced yet. Re-sorts
 * after patch (`startTime ASC NULLS LAST`, the router's own order). */
export function mergeJobVisits(rows: readonly JobVisit[], visit: BoardVisit): JobVisit[] {
  const idx = rows.findIndex((r) => r.id === visit.id)
  const next: JobVisit[] =
    idx === -1
      ? [
          ...rows,
          { ...visit, invoiceState: 'uninvoiced' as const, invoiceCount: 0, invoiceId: undefined },
        ]
      : rows.map((r, i) => (i === idx ? { ...r, ...visit } : r))
  return sortByStartTimeAscNullsLast(next)
}

// ════════════════════════════════════════════════════════════════════════════
// myVisits — the signed-in worker's own Schedule page, keyed `{from,to}`.
// ════════════════════════════════════════════════════════════════════════════

export interface MyVisitsPatchResult {
  rows: MyVisitRow[]
  /** The visit now belongs in this window+viewer but never had a row here (e.g. freshly
   * (re)assigned to this worker) — a `MyVisitListItem` can't be fabricated client-side, it needs
   * the `workOrder.displayName`/`number` join the mutation response doesn't carry. The caller
   * falls back to a scoped `myVisits.invalidate` for just this one window. */
  needsInvalidate: boolean
}

/** Decide + apply one cached `myVisits` window's patch. Rows are implicitly scoped to the
 * viewer server-side (no `assigneeWorkerId` field on the row itself) — a visit stays present only
 * while it's BOTH assigned to one of the viewer's worker rows (their own individual worker OR a
 * team they belong to — `viewerWorkerIds`, mirroring `resolveUserWorkerIds` server-side) AND
 * scheduled inside `window`; anything else (reassigned away, unscheduled, dragged out of range)
 * removes it. `status` never gates removal on its own — `listMyVisits` keeps canceled rows
 * visible (no status filter server-side). */
export function applyMyVisitsPatch(
  rows: readonly MyVisitRow[],
  visit: BoardVisit,
  viewerWorkerIds: readonly string[],
  window: VisitWindow
): MyVisitsPatchResult {
  const idx = rows.findIndex((r) => r.id === visit.id)
  const shouldBePresent =
    !!visit.assigneeWorkerId &&
    viewerWorkerIds.includes(visit.assigneeWorkerId) &&
    isScheduledWithinWindow(visit.startTime, window)

  if (!shouldBePresent) {
    return {
      rows: idx === -1 ? [...rows] : rows.filter((r) => r.id !== visit.id),
      needsInvalidate: false,
    }
  }
  if (idx === -1) {
    return { rows: [...rows], needsInvalidate: true }
  }

  const existing = rows[idx]!
  const updated: MyVisitRow = {
    ...existing,
    status: visit.status as MyVisitRow['status'],
    startTime: visit.startTime as Date,
    endTime: visit.endTime as Date,
    timezone: visit.timezone,
  }
  return {
    rows: sortByStartTimeAscNullsLast(rows.map((r, i) => (i === idx ? updated : r))),
    needsInvalidate: false,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// The one write path — wires the pure functions above into React Query's cache.
// ════════════════════════════════════════════════════════════════════════════

/** What a successful single-row visit mutation hands `applyVisitToCaches`. `visit` is the raw
 * `WorkOrderVisit` row the mutation returned (SuperJSON — dates already real `Date` objects, no
 * rewrap needed). `workOrderStatus` is present whenever the mutation's roll-up ran server-side
 * (absent for `assignVisit`, which has no roll-up rule of its own — see
 * `apps/web/src/server/api/routers/dispatch.ts`'s `withWorkOrderStatus`). `viewerWorkerIds` gates
 * the `myVisits` patch only — omit it to skip that cache entirely (a call site that hasn't
 * threaded the signed-in user's worker ids through). */
export interface VisitCachePatch {
  visit: BoardVisit
  workOrderStatus?: string
  /** The viewer's worker ids (own individual worker + teams they belong to) — see
   * `useViewerWorkerIds`. Gates the `myVisits` optimistic patch. */
  viewerWorkerIds?: readonly string[]
  /** Slot-create's optimistic placeholder cleanup (`addVisit`/`createWorkOrder` — `use-board-
   * mutations.ts`): `onMutate` there inserts a client-generated temp row (`generateId`) before
   * the server assigns real ids. Pass its id here so the `getBoard` patch removes the
   * placeholder instead of leaving it duplicated alongside the real row `patch.visit` carries. */
  removeStaleVisitId?: string
  /** Same idea, for `createWorkOrder`'s synthetic `BoardWorkOrder` placeholder. */
  removeStaleWorkOrderId?: string
}

/**
 * The live handles `applyVisitToCaches` needs. `utils` (`api.useUtils()`) drives the scoped
 * invalidate fallbacks; `queryClient` (`useQueryClient()`) drives the raw multi-key reads/
 * writes — tRPC v11's typed `utils.dispatch.<proc>.setQueriesData` updater callback has no way
 * to see which cached key it's patching (verified against `@trpc/react-query`'s
 * `createUtilityFunctions.ts`/`utilsProxy.ts`: the `Updater<TData, TData>` it forwards to
 * `queryClient.setQueriesData` takes the old data only, never the query key), and window-aware
 * patching needs the window bounds baked into each `getBoard`/`myVisits` query key — so this
 * reads/writes the cache directly via the raw `QueryClient` instead.
 */
export interface ApplyVisitToCachesCtx {
  utils: ReturnType<typeof api.useUtils>
  queryClient: QueryClient
}

function windowInput(queryKey: readonly unknown[]): VisitWindow | undefined {
  return (queryKey[1] as { input?: VisitWindow } | undefined)?.input
}

function listVisitsInput(
  queryKey: readonly unknown[]
): { workOrderRecordId: RecordId } | undefined {
  return (queryKey[1] as { input?: { workOrderRecordId: RecordId } } | undefined)?.input
}

/**
 * Surgically patch every cache that can hold `patch.visit` — `getBoard` (every cached window),
 * `listVisits` (this work order's cache, if open), `myVisits` (every cached window, only when
 * `viewerUserId` is given) — from one mutation response. Idempotent by construction (upsert-by-
 * id), so re-applying the same row twice (an optimistic patch, then the response apply, then a
 * future Phase-2 broadcast apply) is harmless. `getVisitDayMarkers` is the one deliberate
 * exception: a scoped invalidate, not a patch (plan 39 §2.1 judgment call — the mini-calendar
 * dots are a tiny read and correctness math (count per day per worker, across the
 * `includeCanceled` variant) isn't worth hand-maintaining for a query this cheap).
 */
export function applyVisitToCaches(ctx: ApplyVisitToCachesCtx, patch: VisitCachePatch): void {
  const { utils, queryClient } = ctx
  const { visit, workOrderStatus, viewerWorkerIds, removeStaleVisitId, removeStaleWorkOrderId } =
    patch

  const boardKey = getQueryKey(api.dispatch.getBoard, undefined, 'query')
  for (const query of queryClient.getQueryCache().findAll({ queryKey: boardKey })) {
    const window = windowInput(query.queryKey)
    let old = query.state.data as BoardResult | undefined
    if (!window || !old) continue
    if (removeStaleVisitId || removeStaleWorkOrderId) {
      old = {
        ...old,
        visits: removeStaleVisitId
          ? old.visits.filter((v) => v.id !== removeStaleVisitId)
          : old.visits,
        workOrders: removeStaleWorkOrderId
          ? old.workOrders.filter((wo) => wo.id !== removeStaleWorkOrderId)
          : old.workOrders,
      }
    }
    const { board, needsInvalidate } = applyBoardPatch(old, visit, workOrderStatus, window)
    queryClient.setQueryData(query.queryKey, board)
    if (needsInvalidate) void utils.dispatch.getBoard.invalidate(window)
  }

  const listVisitsKey = getQueryKey(api.dispatch.listVisits, undefined, 'query')
  for (const query of queryClient.getQueryCache().findAll({ queryKey: listVisitsKey })) {
    const input = listVisitsInput(query.queryKey)
    const old = query.state.data as JobVisit[] | undefined
    if (!input || !old) continue
    if (getInstanceId(input.workOrderRecordId) !== visit.workOrderId) continue
    queryClient.setQueryData(query.queryKey, mergeJobVisits(old, visit))
  }

  if (viewerWorkerIds && viewerWorkerIds.length > 0) {
    const myVisitsKey = getQueryKey(api.dispatch.myVisits, undefined, 'query')
    for (const query of queryClient.getQueryCache().findAll({ queryKey: myVisitsKey })) {
      const window = windowInput(query.queryKey)
      const old = query.state.data as MyVisitRow[] | undefined
      if (!window || !old) continue
      const { rows, needsInvalidate } = applyMyVisitsPatch(old, visit, viewerWorkerIds, window)
      queryClient.setQueryData(query.queryKey, rows)
      if (needsInvalidate) void utils.dispatch.myVisits.invalidate(window)
    }
  }

  // Pragmatic scoped invalidate (see the doc comment above) — cheap, rare, deliberately unpatched.
  void utils.dispatch.getVisitDayMarkers.invalidate()
}
