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
export interface WaitNodeConfig {
  waitType: WaitType
  durationAmount?: number | string | { id: string; nodeId?: string; path: string }
  isDurationConstant?: boolean
  durationUnit?: DurationUnit
  time?: string | { id: string; nodeId?: string; path: string }
  isTimeConstant?: boolean
  timezone?: string
  duration?: number // Legacy field for backward compatibility
}
