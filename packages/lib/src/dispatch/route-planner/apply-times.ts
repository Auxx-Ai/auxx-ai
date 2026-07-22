// packages/lib/src/dispatch/route-planner/apply-times.ts
//
// "Apply times to schedule" (plans/dispatch/09-route-planner.md §E/§F, build contract item 12;
// anchored-chain rework plans/dispatch/20-route-times-sync.md §4.4; auto-sync §5) — the only
// path that writes `startTime`/`endTime` from the planner. Walks the dispatcher-confirmed stop
// order as a sequence of segments split at CONFIRMED stops (anchors, plan 20 §4.2): an anchor's
// own write is skipped (its time is a promise, not planner math) and its `endTime` becomes the
// next segment's departure; provisional stops between anchors get chained off the same
// Directions leg durations the map preview draws from (cache-shared), written through the
// existing single-visit `scheduleVisit` with `timeWriteKind: 'provisional'` — mirror/roll-up/
// broadcast fire exactly like a manual reschedule. `routeOrder` is left untouched (already
// correct from `setRouteOrder`); only the time fields move. Conflicts (computed arrival at an
// anchor later than its confirmed `startTime`) are NOT errored here — Phase 2 only reports
// them, client-side, in the apply-times dialog preview (§4.4); auto-sync (§5) applies them
// as-computed too, the drift badge is the affordance.

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { resolveAvailability } from '../../availability'
import { NotFoundError } from '../../errors'
import { resolveVisitDurationMinutes } from '../types'
import { scheduleVisit } from '../visit-mutations'
import { getDispatchWorker, listDispatchWorkers } from '../workers'
import { resolveRouteStart } from './depot'
import { getRouteLegs } from './directions'
import type { PlannerDayWindow, RouteStop } from './types'

/** Input for {@link applyRouteTimes}. */
export interface ApplyRouteTimesInput {
  organizationId: string
  userId: string
  assigneeWorkerId: string
  /** `yyyy-MM-dd` label of the planned day, client-resolved — the Directions cache-key day. */
  dateKey: string
  /** The confirmed first-departure time (editable default: worker availability day-start). */
  firstDeparture: Date
  /** Ordered visit ids (dispatcher-confirmed `routeOrder`). Durations are read server-side
   * from each visit's `durationMinutes` (plan 20 §4.1a) — not client input. */
  visitIds: string[]
  excludeSocketId?: string
}

/** Input for {@link autoApplyRouteTimes}. */
export interface AutoApplyRouteTimesInput {
  organizationId: string
  userId: string
  assigneeWorkerId: string
  /** `yyyy-MM-dd` label of the planned day, client-resolved — the Directions cache-key day. */
  dateKey: string
  /** The planned day's client-resolved bounds ({@link PlannerDayWindow}) — `from` is the local
   * day start, the base for the availability first-departure seed. */
  window: Pick<PlannerDayWindow, 'from' | 'to'>
  /** Ordered visit ids (the just-written `routeOrder`) — done/canceled stops are filtered
   * out here, unlike {@link applyRouteTimes} whose dialog caller pre-filters. */
  visitIds: string[]
  excludeSocketId?: string
}

/** The visit columns the chain reads — shared by both apply entry points. */
interface ChainVisitRow {
  id: string
  status: string
  latitude: number | null
  longitude: number | null
  startTime: Date | null
  endTime: Date | null
  timeConfirmedAt: Date | null
  durationMinutes: number | null
}

/** An anchor (plan 20 §4.4): a confirmed time with both bounds set. */
function isAnchorRow(row: ChainVisitRow): boolean {
  return row.timeConfirmedAt !== null && row.startTime !== null && row.endTime !== null
}

async function loadVisitRows(
  organizationId: string,
  visitIds: string[]
): Promise<Map<string, ChainVisitRow>> {
  const rows = await database
    .select({
      id: schema.WorkOrderVisit.id,
      status: schema.WorkOrderVisit.status,
      latitude: schema.WorkOrderVisit.latitude,
      longitude: schema.WorkOrderVisit.longitude,
      startTime: schema.WorkOrderVisit.startTime,
      endTime: schema.WorkOrderVisit.endTime,
      timeConfirmedAt: schema.WorkOrderVisit.timeConfirmedAt,
      durationMinutes: schema.WorkOrderVisit.durationMinutes,
    })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        inArray(schema.WorkOrderVisit.id, visitIds)
      )
    )
  return new Map(rows.map((r) => [r.id, r]))
}

/**
 * Fetch the Directions leg seconds for the ordered stop list, keyed by `toVisitId` — the same
 * `getRouteLegs` call (and cache) the map preview draws from. Ungeocoded stops are dropped from
 * the waypoint list fed to Directions — no leg can be drawn to/from a point with no coordinates;
 * they fall back to a zero-second leg in the chain (no travel-time signal available for them).
 */
async function loadLegSeconds(params: {
  organizationId: string
  assigneeWorkerId: string
  dateKey: string
  visitIds: string[]
  rowsByVisitId: Map<string, ChainVisitRow>
}): Promise<Map<string, number>> {
  const { organizationId, assigneeWorkerId, dateKey, visitIds, rowsByVisitId } = params

  const worker = (await listDispatchWorkers(organizationId)).find((w) => w.id === assigneeWorkerId)
  if (!worker) throw new NotFoundError('Dispatch worker not found')

  const homePoint = await resolveRouteStart(organizationId, worker)
  const depotStart = worker.routeStartAtHome ? homePoint : null
  const depotEnd = worker.routeEndAtHome ? homePoint : null

  const geoStops: RouteStop[] = []
  for (const visitId of visitIds) {
    const row = rowsByVisitId.get(visitId)
    if (row && row.latitude !== null && row.longitude !== null) {
      geoStops.push({ visitId, lat: row.latitude, lng: row.longitude })
    }
  }

  const geometry = await getRouteLegs(
    organizationId,
    assigneeWorkerId,
    dateKey,
    depotStart,
    depotEnd,
    geoStops
  )
  return new Map(geometry.legs.map((leg) => [leg.toVisitId, leg.seconds]))
}

/**
 * The anchored chain core (plan 20 §4.4, contract item 12), shared by both entry points:
 * anchors are skipped (their `endTime` becomes the next segment's departure); provisional
 * stops get `arrival_i = departure_{i-1} + legSeconds_i`, `startTime_i = arrival_i`,
 * `endTime_i = startTime_i + durationMinutes_i` (read via {@link resolveVisitDurationMinutes}),
 * `departure_i = endTime_i` — `departure_0 = firstDeparture`. Writes through `scheduleVisit`
 * per row, in order, with `timeWriteKind: 'provisional'` (each write's mirror/roll-up/broadcast
 * still fires the same as a manual reschedule).
 */
async function runAnchoredChain(params: {
  organizationId: string
  userId: string
  firstDeparture: Date
  visitIds: string[]
  rowsByVisitId: Map<string, ChainVisitRow>
  legSecondsByVisitId: Map<string, number>
  excludeSocketId?: string
}): Promise<void> {
  const {
    organizationId,
    userId,
    firstDeparture,
    visitIds,
    rowsByVisitId,
    legSecondsByVisitId,
    excludeSocketId,
  } = params

  let departure = firstDeparture
  for (const visitId of visitIds) {
    const row = rowsByVisitId.get(visitId)
    if (!row) continue

    if (isAnchorRow(row)) {
      // Confirmed stops are fixed (§4.4): skip the write, chain off its existing endTime. A
      // conflict (the chain's arrival here would have landed after this promised start) is not
      // detectable retroactively once we've skipped ahead — the dialog preview computes and
      // reports it client-side before confirm.
      departure = row.endTime as Date
      continue
    }

    const legSeconds = legSecondsByVisitId.get(visitId) ?? 0
    const durationMinutes = resolveVisitDurationMinutes(row)
    const startTime = new Date(departure.getTime() + legSeconds * 1000)
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000)

    await scheduleVisit({
      organizationId,
      userId,
      visitId,
      startTime,
      endTime,
      timeWriteKind: 'provisional',
      excludeSocketId,
    })

    departure = endTime
  }
}

/**
 * Walk the ordered stops as anchor-delimited segments (plan 20 §4.4) from the given
 * dispatcher-chosen `firstDeparture` — see {@link runAnchoredChain} for the segment math.
 * Callers (the apply-times dialog) pass a pre-filtered active stop list.
 */
export async function applyRouteTimes(input: ApplyRouteTimesInput): Promise<void> {
  const {
    organizationId,
    userId,
    assigneeWorkerId,
    dateKey,
    firstDeparture,
    visitIds,
    excludeSocketId,
  } = input
  if (visitIds.length === 0) return

  const rowsByVisitId = await loadVisitRows(organizationId, visitIds)
  const legSecondsByVisitId = await loadLegSeconds({
    organizationId,
    assigneeWorkerId,
    dateKey,
    visitIds,
    rowsByVisitId,
  })
  await runAnchoredChain({
    organizationId,
    userId,
    firstDeparture,
    visitIds,
    rowsByVisitId,
    legSecondsByVisitId,
    excludeSocketId,
  })
}

/**
 * Auto-sync entry point (plan 20 §5, `dispatch.routes.autoApplyTimes` setting) — re-chains a
 * route's provisional times right after a `setRouteOrder` write, no dialog. Filters the ordered
 * list to active stops (status not `done`/`canceled` — the dialog's client-side filter, done
 * server-side here) and no-ops when none remain or every remaining stop is a confirmed anchor
 * (§4.4 — nothing to write). First-departure seed per §3.2: if any active stop already has a
 * `startTime`, the previously chosen day start is preserved (`min(startTime)` minus the new
 * first stop's leg seconds); otherwise an INDIVIDUAL assignee's availability day-start for
 * `dateKey` (`resolveAvailability`, org-hours fallback) on top of `window.from`, falling back to
 * 08:00 — the apply-times dialog's exact seed. A TEAM assignee has no single person's hours to
 * seed from (45-teams.md §1.F — team availability shading is skipped in v1), so it falls
 * straight through to the 08:00 default. Conflicts at anchors are applied as-computed, same as
 * the dialog path; the drift badge is the affordance.
 */
export async function autoApplyRouteTimes(input: AutoApplyRouteTimesInput): Promise<void> {
  const { organizationId, userId, assigneeWorkerId, dateKey, window, visitIds, excludeSocketId } =
    input
  if (visitIds.length === 0) return

  const rowsByVisitId = await loadVisitRows(organizationId, visitIds)
  const activeVisitIds = visitIds.filter((visitId) => {
    const row = rowsByVisitId.get(visitId)
    return row !== undefined && row.status !== 'done' && row.status !== 'canceled'
  })
  if (activeVisitIds.length === 0) return

  const activeRows = activeVisitIds.map((visitId) => rowsByVisitId.get(visitId) as ChainVisitRow)
  if (activeRows.every(isAnchorRow)) return

  // Legs are fetched ONCE — the seed's first-stop leg and the chain reuse the same map.
  const legSecondsByVisitId = await loadLegSeconds({
    organizationId,
    assigneeWorkerId,
    dateKey,
    visitIds: activeVisitIds,
    rowsByVisitId,
  })

  const timedStartsMs = activeRows
    .filter((row) => row.startTime !== null)
    .map((row) => (row.startTime as Date).getTime())

  let firstDeparture: Date
  if (timedStartsMs.length > 0) {
    // §3.2 — keep the day start the dispatcher previously chose: earliest scheduled start
    // minus the (new) first stop's leg.
    const firstLegSeconds = legSecondsByVisitId.get(activeVisitIds[0] as string) ?? 0
    firstDeparture = new Date(Math.min(...timedStartsMs) - firstLegSeconds * 1000)
  } else {
    // Fresh, unapplied route — an INDIVIDUAL assignee's availability day-start (minutes since
    // local midnight, resolved for the planned day) stamped onto the client-resolved local day
    // start; a TEAM assignee has no single person's hours to seed from (§1.F) and falls through
    // to the 08:00 default.
    let startMinutes = 8 * 60
    const assigneeWorker = await getDispatchWorker(organizationId, assigneeWorkerId)
    if (assigneeWorker?.type === 'individual' && assigneeWorker.userId) {
      const days = await resolveAvailability(
        { type: 'worker', organizationId, userId: assigneeWorker.userId },
        { from: dateKey, to: dateKey }
      )
      startMinutes = days[0]?.ranges[0]?.start ?? 8 * 60
    }
    firstDeparture = new Date(window.from.getTime() + startMinutes * 60_000)
  }

  await runAnchoredChain({
    organizationId,
    userId,
    firstDeparture,
    visitIds: activeVisitIds,
    rowsByVisitId,
    legSecondsByVisitId,
    excludeSocketId,
  })
}
