// apps/web/src/components/dispatch/stores/availability-cache-store.ts

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { coalesce, type DateRange } from '../utils/date-ranges'

/** Subject discriminant for availability reads (mirrors the `availability.resolve` input). */
export type AvailabilitySubject = { type: 'organization' } | { type: 'worker'; userId: string }

/** Cache key for a subject: `'org'` or `` `w:${userId}` ``. Shared by the shading hook + settings. */
export const availabilitySubjectKey = (subject: AvailabilitySubject): string =>
  subject.type === 'organization' ? 'org' : `w:${subject.userId}`

/** Minutes-since-midnight available span, mirrors `availability.resolve`'s `TimeRange`. */
export interface AvailabilityRange {
  start: number
  end: number
}

/** One resolved calendar day, mirrors `availability.resolve`'s `ResolvedDay` output shape. */
export interface ResolvedDay {
  /** `YYYY-MM-DD` */
  date: string
  /** available spans; empty ⇒ the whole day is closed */
  ranges: AvailabilityRange[]
  timezone: string
}

/** Cache for one subject (`'org'` or `` `w:${userId}` ``). */
interface SubjectCache {
  /** Resolved days by date string. Session-only (not persisted). */
  days: Record<string, ResolvedDay>
  /** Coalesced intervals we've already fetched — drives gap-only fetching. Session-only. */
  loadedRanges: DateRange[]
  /** Day-of-week set (0=Sun) that has any weekly hours — the instant baseline. PERSISTED. */
  weeklyWorkingDays: number[] | null
}

interface AvailabilityCacheState {
  subjects: Record<string, SubjectCache>
  /** Merge a resolved batch and record its REQUESTED range as loaded (even all-open days). */
  ingestResolved: (key: string, requested: DateRange, days: ResolvedDay[]) => void
  /** Set/replace a subject's persisted weekly working-days baseline (no-op if unchanged). */
  setWeeklyWorkingDays: (key: string, days: number[]) => void
  /** Drop a subject's resolved cache + baseline (e.g. after an hours edit) so it re-fetches. */
  invalidate: (key: string) => void
  invalidateAll: () => void
}

const emptySubject = (): SubjectCache => ({ days: {}, loadedRanges: [], weeklyWorkingDays: null })

const sameDays = (a: number[] | null, b: number[]): boolean =>
  a !== null && a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Client cache for dispatch availability (12-availability-cache.md §B). Keyed by subject; tracks
 * which date ranges are already fetched (so months already shown are never re-queried) and holds a
 * persisted weekly working-days baseline for instant non-working-day shading. Only the baseline is
 * persisted — resolved days/ranges are session-only (exceptions change; avoids localStorage bloat).
 * Consumers must use selectors, never destructure the whole store (project Zustand convention).
 */
export const useAvailabilityCacheStore = create<AvailabilityCacheState>()(
  persist(
    (set) => ({
      subjects: {},

      ingestResolved: (key, requested, days) =>
        set((state) => {
          const prev = state.subjects[key] ?? emptySubject()
          const nextDays = { ...prev.days }
          for (const d of days) nextDays[d.date] = d
          return {
            subjects: {
              ...state.subjects,
              [key]: {
                ...prev,
                days: nextDays,
                loadedRanges: coalesce([...prev.loadedRanges, requested]),
              },
            },
          }
        }),

      setWeeklyWorkingDays: (key, days) =>
        set((state) => {
          const prev = state.subjects[key] ?? emptySubject()
          if (sameDays(prev.weeklyWorkingDays, days)) return state
          return {
            subjects: { ...state.subjects, [key]: { ...prev, weeklyWorkingDays: days } },
          }
        }),

      invalidate: (key) =>
        set((state) => {
          if (!state.subjects[key]) return state
          const next = { ...state.subjects }
          delete next[key]
          return { subjects: next }
        }),

      invalidateAll: () => set({ subjects: {} }),
    }),
    {
      name: 'availability-cache',
      // Persist ONLY the weekly baseline per subject; rehydrate it into the full session shape.
      partialize: (state) => ({
        subjects: Object.fromEntries(
          Object.entries(state.subjects).map(([k, v]) => [
            k,
            { weeklyWorkingDays: v.weeklyWorkingDays },
          ])
        ),
      }),
      merge: (persisted, current) => {
        const p = persisted as { subjects?: Record<string, { weeklyWorkingDays: number[] | null }> }
        const subjects: Record<string, SubjectCache> = {}
        for (const [k, v] of Object.entries(p.subjects ?? {})) {
          subjects[k] = { ...emptySubject(), weeklyWorkingDays: v.weeklyWorkingDays ?? null }
        }
        return { ...current, subjects }
      },
    }
  )
)
