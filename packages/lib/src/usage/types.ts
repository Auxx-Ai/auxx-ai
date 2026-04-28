// packages/lib/src/usage/types.ts

/**
 * Metered usage metrics. These map to FeatureKey pairs:
 * e.g. 'outboundEmails' → outboundEmailsPerMonthHard / outboundEmailsPerMonthSoft
 */
export type UsageMetric =
  | 'outboundEmails'
  | 'workflowRuns'
  | 'aiCompletions'
  | 'aiTranscriptions'
  | 'apiCalls'

/** Result from UsageGuard.consume() */
export type UsageResult =
  | {
      allowed: true
      current: number
      limit: number | undefined
      unlimited: boolean
      softLimitReached: boolean
    }
  | {
      allowed: false
      reason: 'featureNotAvailable' | 'hardLimitReached'
      current?: number
      limit?: number
      upgradeRequired: boolean
    }

/** Read-only status for UI display */
export interface UsageStatus {
  metric: UsageMetric
  current: number
  hardLimit: number
  softLimit: number
  unlimited: boolean
  percentUsed: number
}

/** Data for the usage event recording job */
export interface RecordUsageEventJobData {
  orgId: string
  metric: string
  quantity: number
  userId?: string
  metadata?: Record<string, unknown>
  periodKey: string
  timestamp: number
}
