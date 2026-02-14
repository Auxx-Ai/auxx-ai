// apps/web/src/components/workflow/nodes/core/wait/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

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
 * Wait node data interface with complete structure
 */
export interface WaitNodeData extends BaseNodeData {
  /** Type of wait operation */
  waitType: WaitType
  /** Duration amount for duration-based wait */
  durationAmount?: number | string
  isDurationConstant: boolean
  /** Duration unit for duration-based wait */
  durationUnit?: DurationUnit
  /** Specific time for time-based wait */
  time?: string
  isTimeConstant: boolean
  /** Timezone for specific time wait */
  timezone?: string
}

/**
 * Full Wait node type for React Flow
 */
export type WaitNode = SpecificNode<'wait', WaitNodeData>
