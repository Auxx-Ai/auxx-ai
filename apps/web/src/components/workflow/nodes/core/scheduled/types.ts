// apps/web/src/components/workflow/nodes/core/scheduled-trigger/types.ts

import type { BaseNodeData } from '~/components/workflow/types/node-base'

/**
 * Frontend-facing interface that matches user requirements
 */
export interface ScheduledTriggerUIConfig {
  triggerInterval: 'minutes' | 'hours' | 'days' | 'weeks' | 'custom'
  timeBetweenTriggers: {
    minutes?: number | string
    hours?: number | string
    days?: number | string
    weeks?: number | string
    isConstant?: boolean
  }
  customCron?: string
  timezone?: string
  startDate?: string // Optional start date for scheduling
}

/**
 * Internal type for validation and processing that matches backend
 */
export interface ProcessedScheduleConfig {
  type: 'cron' | 'interval' | 'once'
  cron?: string
  interval?: {
    value: number
    unit: 'minutes' | 'hours' | 'days' | 'weeks'
  }
  date?: string
  timezone?: string
}

/**
 * Node data structure for scheduled trigger
 */
export interface ScheduledTriggerNodeData extends BaseNodeData {
  config: ScheduledTriggerUIConfig
  isEnabled: boolean
}

/**
 * Node configuration for scheduled trigger
 */
export interface ScheduledTriggerNodeConfig {
  schedule?: ProcessedScheduleConfig
}

/**
 * Validation result for scheduled trigger configuration
 */
export interface ScheduledTriggerValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Preview information for schedule execution
 */
export interface SchedulePreview {
  nextExecutions: Date[]
  description: string
  isValid: boolean
}
