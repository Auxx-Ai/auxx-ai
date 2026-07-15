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

/**
 * Client-notifications plan §4.1/§4.2 — a compiled anchor-mode `SequenceStep`'s wait config.
 * `subjectRef` mirrors `Sequence.subjectKind` (compiled in at publish time); `timezone` is
 * always carried explicitly (not just derived from `deliveryWindow`) because an anchor step
 * still needs a timezone to interpret `timeOfDay` even on a sequence with NO delivery window
 * configured (e.g. the seeded `visit_en_route` sequence).
 */
export interface WaitAnchorConfig {
  subjectRef: 'visit' | 'work_order' | 'invoice'
  /** Signed day offset from the subject's anchor date. */
  offsetDays: number
  /** `'HH:MM'`, local to `timezone`. */
  timeOfDay: string | null
  timezone: string
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
  /** Client-notifications plan §4.2 — resolve the wait's target from a subject's live anchor
   * date instead of a fixed enrollment-relative delay. Compiled by `buildSequenceGraph` for
   * `timingMode='anchor'` steps only. */
  anchor?: WaitAnchorConfig
}
