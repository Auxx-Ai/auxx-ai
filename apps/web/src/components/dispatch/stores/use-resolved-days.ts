// apps/web/src/components/dispatch/stores/use-resolved-days.ts
'use client'

import { useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import { chunkRange, type DateRange, subtractRanges } from '../utils/date-ranges'
import {
  type AvailabilitySubject,
  availabilitySubjectKey,
  type ResolvedDay,
  useAvailabilityCacheStore,
} from './availability-cache-store'

/** `availability.resolve` hard-caps at 366 days; keep requests comfortably below that limit. */
const MAX_FETCH_DAYS = 180

// Requests are shared across hook instances (board shading, popover hints, etc.). Treat pending
// ranges as covered while calculating gaps so a fast-moving calendar window cannot launch several
// mostly-overlapping resolves before the first response has had a chance to enter the store.
const pendingRangesBySubject = new Map<string, Map<string, DateRange>>()

function pendingRanges(key: string): DateRange[] {
  return Array.from(pendingRangesBySubject.get(key)?.values() ?? [])
}

function reservePendingRange(key: string, range: DateRange): string | null {
  const tag = `${range.from}:${range.to}`
  const subjectRanges = pendingRangesBySubject.get(key) ?? new Map<string, DateRange>()
  if (subjectRanges.has(tag)) return null
  subjectRanges.set(tag, range)
  pendingRangesBySubject.set(key, subjectRanges)
  return tag
}

function releasePendingRange(key: string, tag: string): void {
  const subjectRanges = pendingRangesBySubject.get(key)
  if (!subjectRanges) return
  subjectRanges.delete(tag)
  if (subjectRanges.size === 0) pendingRangesBySubject.delete(key)
}

/** A subject paired with its stable cache key. */
interface ResolvedDaysSubject {
  key: string
  subject: AvailabilitySubject
}

/** Creates a cache-addressable subject entry. */
function toResolvedDaysSubject(subject: AvailabilitySubject): ResolvedDaysSubject {
  return { key: availabilitySubjectKey(subject), subject }
}

/**
 * Reads resolved availability days from the shared store and fetches only uncovered gaps for the
 * supplied subjects/range. This is the single client-side path for availability.resolve consumers.
 */
export function useResolvedDaysForSubjects(
  subjects: AvailabilitySubject[],
  fromIso: string,
  toIso: string
): Record<string, ResolvedDay[]> {
  const utils = api.useUtils()
  const cacheSubjects = useAvailabilityCacheStore((state) => state.subjects)
  const ingestResolved = useAvailabilityCacheStore((state) => state.ingestResolved)
  const range = useMemo<DateRange>(() => ({ from: fromIso, to: toIso }), [fromIso, toIso])
  const entries = useMemo(() => subjects.map(toResolvedDaysSubject), [subjects])

  useEffect(() => {
    for (const { key, subject } of entries) {
      const loaded = cacheSubjects[key]?.loadedRanges ?? []
      const covered = [...loaded, ...pendingRanges(key)]
      const gaps = subtractRanges(range, covered).flatMap((gap) => chunkRange(gap, MAX_FETCH_DAYS))
      for (const gap of gaps) {
        const tag = reservePendingRange(key, gap)
        if (!tag) continue
        utils.availability.resolve
          .fetch({ subject, from: gap.from, to: gap.to })
          .then((days) => ingestResolved(key, gap, days))
          .catch(() => {})
          .finally(() => releasePendingRange(key, tag))
      }
    }
  }, [cacheSubjects, entries, ingestResolved, range, utils])

  return useMemo(
    () =>
      Object.fromEntries(
        entries.map(({ key }) => [
          key,
          Object.values(cacheSubjects[key]?.days ?? {}).filter(
            (day) => day.date >= fromIso && day.date <= toIso
          ),
        ])
      ),
    [cacheSubjects, entries, fromIso, toIso]
  )
}

/**
 * Convenience wrapper for a single subject. Pass `null` while the subject is unknown to avoid a
 * placeholder request; it returns no days until a real subject is supplied.
 */
export function useResolvedDays(
  subject: AvailabilitySubject | null,
  fromIso: string | undefined,
  toIso: string | undefined
): ResolvedDay[] {
  const subjects = useMemo(() => (subject ? [subject] : []), [subject])
  const resolved = useResolvedDaysForSubjects(subjects, fromIso ?? '', toIso ?? '')
  const key = subject ? availabilitySubjectKey(subject) : ''
  return resolved[key] ?? []
}
