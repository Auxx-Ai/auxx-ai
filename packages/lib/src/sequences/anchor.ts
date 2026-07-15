// packages/lib/src/sequences/anchor.ts
// Anchored-step date math (client-notifications plan §4.2). Two layers, deliberately split:
// pure math (`computeAnchorTarget`/`isPastAnchor` — unit-tested, no I/O) vs the live DB read
// (`resolveSubjectAnchorDate` — visit `startTime` / invoice `invoice_due_date`). Shared by the
// wait node's anchor branch, the sequence-send-email node's live-anchor recompute guard, and
// `reanchorSequenceRuns`.

import { type Database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { addDays, setHours, setMilliseconds, setMinutes, setSeconds } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { UnifiedCrudHandler } from '../resources/crud'
import { SystemUserService } from '../users/system-user-service'

/** Sequence.subjectKind values that carry a live anchor date. */
export type AnchorSubjectKind = 'visit' | 'work_order' | 'invoice'

/** A compiled anchor step's offset/time-of-day (`SequenceStep.anchorOffsetDays`/`anchorTimeOfDay`). */
export interface AnchorStepConfig {
  /** Signed day offset from the subject's anchor date — negative = before. */
  offsetDays: number
  /** `'HH:MM'` local to `timezone`. Null falls back to the anchor date's own wall-clock time. */
  timeOfDay: string | null
}

function parseHHMM(value: string): [number, number] {
  const [h, m] = value.split(':').map((part) => Number(part))
  return [h ?? 0, m ?? 0]
}

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Pure: `target = anchorDate + offsetDays @ timeOfDay`, evaluated in `timezone` wall-clock
 * time (mirrors `delivery-window.ts`'s `toZonedTime`/`fromZonedTime` pattern — assumes the
 * process runs with `TZ=UTC`). `anchorDate: null` (no due date / no start time yet) returns
 * `null` — the NULL-anchor-skip rule (decision #10), left for the caller to act on.
 */
export function computeAnchorTarget(
  anchorDate: Date | null,
  config: AnchorStepConfig,
  timezone: string
): Date | null {
  if (!anchorDate) return null

  const zoned = toZonedTime(anchorDate, timezone)
  const shifted = addDays(zoned, config.offsetDays)
  const [hours, minutes] = config.timeOfDay
    ? parseHHMM(config.timeOfDay)
    : [shifted.getHours(), shifted.getMinutes()]
  const atTimeOfDay = setMilliseconds(
    setSeconds(setMinutes(setHours(shifted, hours), minutes), 0),
    0
  )

  return fromZonedTime(atTimeOfDay, timezone)
}

/**
 * Whether a computed anchor target is already behind `now` — the past-anchor rule (decision
 * #10): a step whose moment has already passed is skipped, never sent late. `target === null`
 * (NULL anchor) counts as past too, so callers can use one guard for both skip reasons.
 */
export function isPastAnchor(target: Date | null, now: Date = new Date()): boolean {
  return target === null || target.getTime() <= now.getTime()
}

export interface SubjectAnchorDate {
  /** False when the subject row itself no longer exists (deleted visit/invoice instance). */
  exists: boolean
  /** The subject's live anchor date, or null when it exists but has none yet (unscheduled
   * visit / invoice with no due date). */
  anchorDate: Date | null
}

/**
 * Resolve a subject's LIVE anchor date — visit `startTime`, or the invoice EntityInstance's
 * `invoice_due_date` field value (nullable, freely editable after send — §3's corrected
 * payment-reminder foundation note). `work_order` subjects have no anchor date in v1
 * (job-follow-up only uses relative steps); resolves to `{ exists, anchorDate: null }` when
 * the row exists.
 */
export async function resolveSubjectAnchorDate(
  db: Database,
  organizationId: string,
  subjectKind: AnchorSubjectKind,
  subjectId: string
): Promise<SubjectAnchorDate> {
  if (subjectKind === 'visit') {
    const visit = await db.query.WorkOrderVisit.findFirst({
      where: and(
        eq(schema.WorkOrderVisit.id, subjectId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      ),
      columns: { startTime: true },
    })
    if (!visit) return { exists: false, anchorDate: null }
    return { exists: true, anchorDate: visit.startTime ?? null }
  }

  const entity = await db.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.id, subjectId),
      eq(schema.EntityInstance.organizationId, organizationId)
    ),
    columns: { id: true },
  })
  if (!entity) return { exists: false, anchorDate: null }

  if (subjectKind === 'work_order') {
    return { exists: true, anchorDate: null }
  }

  // invoice
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['invoice_due_date'] as const)
  if (!cf.invoice_due_date) return { exists: true, anchorDate: null }

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
  const handler = new UnifiedCrudHandler(organizationId, systemUserId, db)
  const values = await handler.getFieldValues(toRecordId('invoice', subjectId), [
    cf.invoice_due_date.id,
  ])
  const typed = firstTyped(values.get(cf.invoice_due_date.id))
  const raw = typed ? (extractValue(typed) as string) : undefined
  return { exists: true, anchorDate: raw ? new Date(raw) : null }
}
