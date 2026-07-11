// packages/lib/src/availability/index.ts
//
// Server entrypoint for the subject-agnostic availability module — `OperatingHours`
// weekly-hours + exceptions + resolution (plans/dispatch/05-availability.md §A.2).
// Functional + Drizzle, no model classes (money/dispatch are the direct siblings).

export { addException, deleteException, listExceptions, updateException } from './exceptions'
export { resolveAvailability } from './resolve'
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
export { getWeeklyHours, saveWeeklyHours } from './weekly-hours'
