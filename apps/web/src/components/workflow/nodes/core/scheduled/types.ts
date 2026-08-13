// apps/web/src/components/workflow/nodes/core/scheduled/types.ts

import type { CatalogScheduledTriggerNodeData } from '@auxx/lib/workflow-engine/client'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/scheduled`). The processed/preview
// helper types below are web-only and stay.
export type { ScheduledTriggerUIConfig } from '@auxx/lib/workflow-engine/client'

/**
 * Node data structure for scheduled trigger
 */
export interface ScheduledTriggerNodeData extends CatalogScheduledTriggerNodeData {
  type: NodeType
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
