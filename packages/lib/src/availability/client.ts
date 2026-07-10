// packages/lib/src/availability/client.ts
'use client'

// Pure types + validation only — no `@auxx/database`/server deps. Lets the availability
// editing UI (WeeklyHoursEditor, ExceptionListEditor) share the exact validation rules the
// server enforces (05-availability.md §A.2, §C.3).
export type {
  AddExceptionInput,
  AvailabilitySubject,
  ExceptionGroup,
  ExceptionListRange,
  ResolvedDay,
  TimeRange,
  WeeklyHours,
} from './types'
export { validateRanges, validateWeeklyHours, weekStartToIndex } from './validation'
