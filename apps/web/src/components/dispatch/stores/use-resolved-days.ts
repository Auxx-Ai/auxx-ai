// apps/web/src/components/dispatch/stores/use-resolved-days.ts
'use client'

import { useEffect, useMemo, useRef } from 'react'
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

/** A subject paired with its stable cache key. */
interface ResolvedDaysSubject {
  key: string
  subject: AvailabilitySubject
}

/** Creates a cache-addressable subject entry. */
function toResolvedDaysSubject(subject: AvailabilitySubject): ResolvedDaysSubject {
  return { key: availabilitySubjectKey(subject), subject }
}

/** Returns a stable signature so equivalent subject arrays do not restart the fetch effect. */
function subjectSignature(subjects: ResolvedDaysSubject[]): string {
  return subjects.map(({ key }) => key).join(',')
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
  const inFlight = useRef(new Set<string>())
  const range = useMemo<DateRange>(() => ({ from: fromIso, to: toIso }), [fromIso, toIso])
  const entries = useMemo(() => subjects.map(toResolvedDaysSubject), [subjects])
  const signature = subjectSignature(entries)

  useEffect(() => {
    for (const { key, subject } of entries) {
      const loaded = cacheSubjects[key]?.loadedRanges ?? []
      const gaps = subtractRanges(range, loaded).flatMap((gap) => chunkRange(gap, MAX_FETCH_DAYS))
      for (const gap of gaps) {
        const tag = `${key}:${gap.from}:${gap.to}`
        if (inFlight.current.has(tag)) continue
        inFlight.current.add(tag)
        utils.availability.resolve
          .fetch({ subject, from: gap.from, to: gap.to })
          .then((days) => ingestResolved(key, gap, days))
          .catch(() => {})
          .finally(() => inFlight.current.delete(tag))
      }
    }
  }, [cacheSubjects, entries, ingestResolved, range, signature, utils])

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
