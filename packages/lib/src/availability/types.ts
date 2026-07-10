// packages/lib/src/availability/types.ts
//
// Shared types for the `OperatingHours` availability module (plans/dispatch/05-availability.md
// §A.2). Subject-agnostic: the same shapes back org hours, worker hours, and (later) widget
// hours. Client-safe — no `@auxx/database` imports here.

/** Who a set of `OperatingHours` rows belongs to. */
export type AvailabilitySubject =
  | { type: 'organization'; organizationId: string }
  | { type: 'worker'; organizationId: string; userId: string }
  | { type: 'widget'; organizationId: string; widgetId: string }

/** Minutes-since-midnight time range, e.g. `{ start: 540, end: 1020 }` = 9:00 AM–5:00 PM. */
export interface TimeRange {
  start: number
  end: number
}

/**
 * A subject's recurring weekly schedule. A day absent from `days` (or present with zero
 * ranges) is closed. One timezone applies to every row (05-availability.md decision 4).
 */
export interface WeeklyHours {
  timezone: string
  /** `dayOfWeek`: 0-6, 0 = Sunday (JS `getDay()` convention). */
  days: Array<{ dayOfWeek: number; ranges: TimeRange[] }>
}

/**
 * A regrouped run of exception rows — contiguous dates sharing the same `isAvailable`/
 * `label`/`ranges` collapse into one group for display. `ids` are the underlying row ids
 * (used by `deleteException`).
 */
export interface ExceptionGroup {
  ids: string[]
  /** ISO date `YYYY-MM-DD`. */
  dateFrom: string
  /** ISO date `YYYY-MM-DD`. */
  dateTo: string
  label: string | null
  isAvailable: boolean
  /** Empty when `isAvailable === false`. */
  ranges: TimeRange[]
}

/** Input for `addException` — materializes one or more `OperatingHours` exception rows. */
export interface AddExceptionInput {
  /** ISO date `YYYY-MM-DD`. */
  dateFrom: string
  /** ISO date `YYYY-MM-DD`; defaults to `dateFrom`. */
  dateTo?: string
  label?: string
  isAvailable: boolean
  /** Ignored when `isAvailable` is `false`. Required (1+) when `true`. */
  ranges?: TimeRange[]
}

/** Optional date bounds for `listExceptions`. */
export interface ExceptionListRange {
  from?: string
  to?: string
}

/** The effective schedule for a single calendar date, after resolving precedence. */
export interface ResolvedDay {
  /** ISO date `YYYY-MM-DD`. */
  date: string
  ranges: TimeRange[]
  timezone: string
}
