// packages/lib/src/dispatch/digest.ts
//
// Opt-in daily schedule digest (plans/dispatch/19-client-notifications.md §4.9) — for every
// org whose LOCAL time just crossed the digest hour (default 06:00, org timezone), email each
// worker with at least one visit that local day (and `notification.dispatch.dailyDigest` on)
// a summary: time window, job number/title, address. Workers with zero visits or the pref off
// are skipped entirely (never enqueued). Runs hourly via `dispatchDigestJob`
// (packages/lib/src/jobs/maintenance/dispatch-digest-job.ts); the internal hour-bucket check
// (`isDigestHourBucket`) plus a per-org Redis marker (`claimDigestSendOnce`) make a same-day
// double-send (retry, a late tick catching the same bucket twice, an hour repeating across a
// DST fall-back) a no-op.

import { WEBAPP_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { format } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { and, eq, gte, isNotNull, lt, ne } from 'drizzle-orm'
import { enqueueEmailJob } from '../jobs/email/enqueue-email-job'
import { getUserSetting } from '../settings'
import { getWorkOrderProjections } from './work-order-fields'

const logger = createScopedLogger('dispatch:digest')

/** Org-local hour the digest fires at (24h, org timezone). Not yet org-configurable — v1.5. */
export const DEFAULT_DIGEST_HOUR = 6

/** Local hour-of-day (0-23) right now in `timezone`. */
export function localHourNow(timezone: string, now: Date = new Date()): number {
  return toZonedTime(now, timezone).getHours()
}

/**
 * Whether `now`'s local hour in `timezone` is the digest-hour bucket — i.e. this is the hourly
 * sweep tick that "just crossed" `digestHour`. Pure function, exported for unit testing the
 * hour-bucket math independent of DB/Redis.
 */
export function isDigestHourBucket(
  timezone: string,
  digestHour: number = DEFAULT_DIGEST_HOUR,
  now: Date = new Date()
): boolean {
  return localHourNow(timezone, now) === digestHour
}

/** Local calendar date (`YYYY-MM-DD`) for "today" in `timezone` — both the digest's day window
 * anchor and the dedupe key's day bucket. */
export function localDateKey(timezone: string, now: Date = new Date()): string {
  return format(toZonedTime(now, timezone), 'yyyy-MM-dd')
}

/** Local calendar day `[start, end)` for `dateIso` in `timezone`, as UTC instants — the visit
 * query window (the `recurring/materialize.ts` `localDateStartUtc` pattern). */
function localDayWindowUtc(dateIso: string, timezone: string): { start: Date; end: Date } {
  const [year, month, day] = dateIso.split('-').map(Number)
  const start = fromZonedTime(new Date(year!, month! - 1, day!), timezone)
  const end = fromZonedTime(new Date(year!, month! - 1, day! + 1), timezone)
  return { start, end }
}

/** Org's configured timezone — first `OperatingHours` weekly row for the org subject, `'UTC'`
 * fallback (the `availability/resolve.ts` org-timezone convention; there's no dedicated
 * `Organization.timezone` column). Exported for reuse by other dispatch server-side guards
 * (e.g. `notify.ts`'s dispatch day-window check) that need the same "today" the board/digest
 * already agree on. */
export async function resolveOrgTimezone(organizationId: string): Promise<string> {
  const rows = await database.query.OperatingHours.findMany({
    where: and(
      eq(schema.OperatingHours.organizationId, organizationId),
      eq(schema.OperatingHours.subjectType, 'organization'),
      eq(schema.OperatingHours.kind, 'weekly')
    ),
    columns: { timezone: true },
    limit: 1,
  })
  return rows[0]?.timezone ?? 'UTC'
}

/** SET NX a `dispatch-digest:{orgId}:{dateKey}` marker (48h TTL — comfortably covers retries
 * and a DST-repeated hour within the same local day). Returns true when THIS call claimed it
 * (i.e. go ahead and send); false when another tick already claimed the day. Redis down → true
 * (fail open — better a rare duplicate digest than silently skipping every org, mirrors
 * `webhooks/inbound/dedupe/redis.ts`). */
async function claimDigestSendOnce(organizationId: string, dateKey: string): Promise<boolean> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return true
    const key = `dispatch-digest:${organizationId}:${dateKey}`
    const set = await redis.set(key, '1', 'EX', 60 * 60 * 48, 'NX')
    return Boolean(set)
  } catch (error) {
    logger.warn('Digest send-once claim failed, sending anyway', { error, organizationId })
    return true
  }
}

/** One digest email's worth of visits for a single worker. */
interface DigestVisitRow {
  workOrderId: string
  startTime: Date
  endTime: Date
}

/**
 * Run the digest sweep once — called hourly by `dispatchDigestJob`. Iterates every org,
 * skips any whose local time isn't currently at the digest hour, claims the per-org/day
 * Redis marker (double-send guard), then emails every worker with visits that local day and
 * the `notification.dispatch.dailyDigest` pref on.
 */
export async function runDispatchDigestSweep(): Promise<void> {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)

  for (const org of orgs) {
    try {
      await runDigestForOrg(org.id)
    } catch (error) {
      logger.error('Dispatch digest sweep failed for org', { error, organizationId: org.id })
    }
  }
}

async function runDigestForOrg(organizationId: string): Promise<void> {
  const timezone = await resolveOrgTimezone(organizationId)
  if (!isDigestHourBucket(timezone)) return

  const dateKey = localDateKey(timezone)
  if (!(await claimDigestSendOnce(organizationId, dateKey))) return

  const { start, end } = localDayWindowUtc(dateKey, timezone)

  const visits = await database
    .select({
      id: schema.WorkOrderVisit.id,
      workOrderId: schema.WorkOrderVisit.workOrderId,
      assigneeUserId: schema.WorkOrderVisit.assigneeUserId,
      startTime: schema.WorkOrderVisit.startTime,
      endTime: schema.WorkOrderVisit.endTime,
    })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        isNotNull(schema.WorkOrderVisit.assigneeUserId),
        gte(schema.WorkOrderVisit.startTime, start),
        lt(schema.WorkOrderVisit.startTime, end),
        ne(schema.WorkOrderVisit.status, 'canceled')
      )
    )

  if (visits.length === 0) return

  const visitsByAssignee = new Map<string, DigestVisitRow[]>()
  for (const visit of visits) {
    if (!visit.assigneeUserId || !visit.startTime || !visit.endTime) continue
    const list = visitsByAssignee.get(visit.assigneeUserId) ?? []
    list.push({
      workOrderId: visit.workOrderId,
      startTime: visit.startTime,
      endTime: visit.endTime,
    })
    visitsByAssignee.set(visit.assigneeUserId, list)
  }
  if (visitsByAssignee.size === 0) return

  const workOrderIds = Array.from(new Set(visits.map((v) => v.workOrderId)))
  const workOrderInfo = await getWorkOrderProjections(organizationId, undefined, workOrderIds, [
    'number',
    'title',
    'address',
  ])
  const dateLabel = toZonedTime(new Date(), timezone).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  const scheduleUrl = `${WEBAPP_URL}/app/schedule`

  for (const [assigneeUserId, assigneeVisits] of visitsByAssignee) {
    try {
      const digestEnabled = await getUserSetting({
        organizationId,
        userId: assigneeUserId,
        key: 'notification.dispatch.dailyDigest',
      })
      if (digestEnabled !== true) continue

      const assignee = await database.query.User.findFirst({
        where: eq(schema.User.id, assigneeUserId),
      })
      if (!assignee?.email) continue

      const sortedVisits = [...assigneeVisits].sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime()
      )

      await enqueueEmailJob('visit-daily-digest', {
        recipient: { email: assignee.email, name: assignee.name ?? undefined },
        dateLabel,
        timezone,
        visits: sortedVisits.map((visit) => {
          const info = workOrderInfo.get(visit.workOrderId)
          return {
            workOrderNumber: info?.number ?? '',
            workOrderTitle: info?.title ?? 'Work order',
            startTime: visit.startTime.toISOString(),
            endTime: visit.endTime.toISOString(),
            address: info?.address,
          }
        }),
        scheduleUrl,
        source: 'dispatch.dailyDigest',
        organizationId,
      })
    } catch (error) {
      logger.error('Failed to send dispatch daily digest to worker', {
        error,
        organizationId,
        assigneeUserId,
      })
    }
  }
}
