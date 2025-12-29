// packages/lib/src/workflow-engine/constants/wait/wait.constants.ts

export const WAIT_CONSTANTS = {
  DURATION: {
    MIN: 1,
    MAX: 999999,
    UNITS: ['seconds', 'minutes', 'hours', 'days'] as const,
  },
  SPECIFIC_TIME: {
    MIN_FUTURE_MINUTES: 1, // Must be at least 1 minute in the future
    MAX_FUTURE_DAYS: 365, // Maximum 1 year in the future
  },
  EXECUTION: {
    MAX_WAIT_DURATION_MS: 31536000000, // 1 year in milliseconds
    MIN_WAIT_DURATION_MS: 100, // 100 milliseconds
    SHORT_DELAY_THRESHOLD_MS: 10000, // 10 seconds - use setTimeout for delays below this
  },
} as const

export type DurationUnit = (typeof WAIT_CONSTANTS.DURATION.UNITS)[number]
