/**
 * Wait type options
 */
export enum WaitType {
  DURATION = 'duration',
  SPECIFIC_TIME = 'specific_time',
}

/**
 * Duration unit options
 */
export enum DurationUnit {
  SECONDS = 'seconds',
  MINUTES = 'minutes',
  HOURS = 'hours',
  DAYS = 'days',
}
/**
 * Sequences plan §3.3 — an optional delivery window applied to the computed
 * `resumeAt`, snapping it forward into business hours/days. See
 * `./delivery-window.ts` for the pure snapping math.
 */
export interface WaitDeliveryWindowConfig {
  /** `HH:MM`, 24h, local to `timezone`. */
  startTime: string
  /** `HH:MM`, 24h, local to `timezone`. */
  endTime: string
  /** IANA timezone, e.g. `America/New_York`. */
  timezone: string
  businessDaysOnly: boolean
}

export interface WaitNodeConfig {
  waitType: WaitType
  durationAmount?: number | string | { id: string; nodeId?: string; path: string }
  isDurationConstant?: boolean
  durationUnit?: DurationUnit
  time?: string | { id: string; nodeId?: string; path: string }
  isTimeConstant?: boolean
  timezone?: string
  duration?: number // Legacy field for backward compatibility
  /** Sequences plan §3.3 — snap the computed `resumeAt` into this window. */
  deliveryWindow?: WaitDeliveryWindowConfig
}
