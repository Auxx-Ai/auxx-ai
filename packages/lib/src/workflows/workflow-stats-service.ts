// packages/lib/src/workflows/workflow-stats-service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  addDays,
  addHours,
  addWeeks,
  differenceInDays,
  eachDayOfInterval,
  eachHourOfInterval,
  eachWeekOfInterval,
  format,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns'
import { and, asc, count, desc, eq, gte, isNotNull, lte } from 'drizzle-orm'
import type {
  CustomDateRange,
  DetailedTimeRange,
  TimeRange,
  TimeSeriesDataPoint,
  WorkflowDetailedStats,
  WorkflowRun,
  WorkflowStats,
} from './types'

const logger = createScopedLogger('workflow-stats-service')

export class WorkflowStatsService {
  constructor(private db: Database) {}

  /**
   * Get workflow execution statistics
   */
  async getStats(
    workflowId: string,
    organizationId: string,
    timeRange: TimeRange
  ): Promise<WorkflowStats> {
    logger.info('Fetching workflow statistics', { workflowId, timeRange, organizationId })

    try {
      // Calculate time range
      const now = new Date()
      const timeRangeMap = {
        '1h': new Date(now.getTime() - 60 * 60 * 1000),
        '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
        '7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        '30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        '90d': new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      }
      const startDate = timeRangeMap[timeRange]

      // Get WorkflowApp to find the published workflow
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, workflowId),
          eq(schema.WorkflowApp.organizationId, organizationId)
        ),
        with: {
          publishedWorkflow: true,
        },
      })

      if (!workflowApp || !workflowApp.publishedWorkflow) {
        throw new Error('Published workflow not found')
      }

      const publishedWorkflowId = workflowApp.publishedWorkflow.id

      // Get execution statistics using WorkflowRun data
      const [runs, totalCount, successCount, failureCount, completedRuns] = await Promise.all([
        // Recent workflow runs
        this.db.query.WorkflowRun.findMany({
          where: and(
            eq(schema.WorkflowRun.workflowId, publishedWorkflowId),
            gte(schema.WorkflowRun.createdAt, startDate)
          ),
          columns: {
            id: true,
            status: true,
            createdAt: true,
            finishedAt: true,
            error: true,
          },
          orderBy: desc(schema.WorkflowRun.createdAt),
          limit: 100,
        }),

        // Total count
        this.db
          .select({ count: count() })
          .from(schema.WorkflowRun)
          .where(
            and(
              eq(schema.WorkflowRun.workflowId, publishedWorkflowId),
              gte(schema.WorkflowRun.createdAt, startDate)
            )
          )
          .then((result) => result[0]?.count || 0),

        // Success count
        this.db
          .select({ count: count() })
          .from(schema.WorkflowRun)
          .where(
            and(
              eq(schema.WorkflowRun.workflowId, publishedWorkflowId),
              eq(schema.WorkflowRun.status, 'SUCCEEDED'),
              gte(schema.WorkflowRun.createdAt, startDate)
            )
          )
          .then((result) => result[0]?.count || 0),

        // Failure count
        this.db
          .select({ count: count() })
          .from(schema.WorkflowRun)
          .where(
            and(
              eq(schema.WorkflowRun.workflowId, publishedWorkflowId),
              eq(schema.WorkflowRun.status, 'FAILED'),
              gte(schema.WorkflowRun.createdAt, startDate)
            )
          )
          .then((result) => result[0]?.count || 0),

        // Average execution time (calculate from createdAt and finishedAt)
        this.db.query.WorkflowRun.findMany({
          where: and(
            eq(schema.WorkflowRun.workflowId, publishedWorkflowId),
            eq(schema.WorkflowRun.status, 'SUCCEEDED'),
            gte(schema.WorkflowRun.createdAt, startDate),
            isNotNull(schema.WorkflowRun.finishedAt)
          ),
          columns: {
            createdAt: true,
            finishedAt: true,
          },
        }),
      ])

      const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0

      // Calculate average execution time from completed runs
      const avgExecutionTime =
        completedRuns.length > 0
          ? completedRuns.reduce((sum, run) => {
              const duration = run.finishedAt!.getTime() - run.createdAt.getTime()
              return sum + duration
            }, 0) / completedRuns.length
          : 0

      return {
        totalExecutions: totalCount,
        successfulExecutions: successCount,
        failedExecutions: failureCount,
        successRate,
        averageExecutionTime: Math.round(avgExecutionTime),
        recentExecutions: runs as WorkflowRun[],
        timeRange,
      }
    } catch (error) {
      logger.error('Failed to fetch workflow statistics', { error, workflowId, organizationId })
      throw error
    }
  }

  /**
   * Get workflow runs for a workflow app
   */
  async getWorkflowRuns(
    workflowAppId: string,
    organizationId: string,
    limit: number = 20
  ): Promise<WorkflowRun[]> {
    logger.info('Fetching workflow runs', { workflowAppId, organizationId, limit })

    try {
      // Verify WorkflowApp exists and belongs to organization
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, workflowAppId),
          eq(schema.WorkflowApp.organizationId, organizationId)
        ),
      })

      if (!workflowApp) {
        throw new Error('Workflow app not found')
      }

      // Fetch workflow runs
      const runs = await this.db.query.WorkflowRun.findMany({
        where: and(
          eq(schema.WorkflowRun.workflowAppId, workflowAppId),
          eq(schema.WorkflowRun.organizationId, organizationId)
        ),
        orderBy: desc(schema.WorkflowRun.createdAt),
        limit,
        with: {
          createdBy: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      })

      return runs
    } catch (error) {
      logger.error('Failed to fetch workflow runs', { error, workflowAppId, organizationId })
      throw error
    }
  }

  /**
   * Get detailed workflow statistics with time-series data
   */
  async getDetailedStats(
    workflowId: string,
    organizationId: string,
    timeRange: DetailedTimeRange,
    customDateRange?: CustomDateRange
  ): Promise<WorkflowDetailedStats> {
    logger.info('Fetching detailed workflow statistics', { workflowId, timeRange, organizationId })

    try {
      // Calculate date range
      const { from, to, bucketType } = this.calculateDateRange(timeRange, customDateRange)
      logger.info('Date range calculated', { from, to, bucketType, timeRange })

      // Get WorkflowApp to find the published workflow
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, workflowId),
          eq(schema.WorkflowApp.organizationId, organizationId)
        ),
        with: {
          publishedWorkflow: true,
        },
      })

      if (!workflowApp) {
        logger.error('WorkflowApp not found', { workflowId, organizationId })
        throw new Error('Workflow app not found')
      }

      let publishedWorkflowId: string

      if (!workflowApp.publishedWorkflow) {
        logger.warn('No published workflow found, trying draft workflow', {
          workflowAppId: workflowApp.id,
        })

        // Try to get draft workflow instead
        const workflowAppWithDraft = await this.db.query.WorkflowApp.findFirst({
          where: and(
            eq(schema.WorkflowApp.id, workflowId),
            eq(schema.WorkflowApp.organizationId, organizationId)
          ),
          with: {
            draftWorkflow: true,
          },
        })

        if (!workflowAppWithDraft?.draftWorkflow) {
          throw new Error('Neither published nor draft workflow found')
        }

        // Use draft workflow for stats
        publishedWorkflowId = workflowAppWithDraft.draftWorkflow.id
        logger.info('Using draft workflow for stats', { draftWorkflowId: publishedWorkflowId })
      } else {
        publishedWorkflowId = workflowApp.publishedWorkflow.id
      }

      // Get all workflow runs in the date range
      const runs = await this.db.query.WorkflowRun.findMany({
        where: and(
          eq(schema.WorkflowRun.workflowId, publishedWorkflowId),
          gte(schema.WorkflowRun.createdAt, from),
          lte(schema.WorkflowRun.createdAt, to)
        ),
        columns: {
          id: true,
          status: true,
          createdAt: true,
          finishedAt: true,
          totalTokens: true,
          error: true,
        },
        orderBy: asc(schema.WorkflowRun.createdAt),
      })

      // Generate time buckets
      const timeBuckets = this.generateTimeBuckets(from, to, bucketType)

      // Aggregate data by time buckets
      const executionsOverTime = this.aggregateExecutions(runs, timeBuckets, bucketType)
      const tokenUsageOverTime = this.aggregateTokenUsage(runs, timeBuckets, bucketType)
      const successRateOverTime = this.aggregateSuccessRate(runs, timeBuckets, bucketType)
      const avgExecutionTimeOverTime = this.aggregateExecutionTime(runs, timeBuckets, bucketType)

      // Calculate summary statistics
      const totalExecutions = runs.length
      const totalTokens = runs.reduce((sum, run) => sum + (run.totalTokens || 0), 0)

      const successfulRuns = runs.filter(
        (run) => run.status === 'SUCCEEDED' || run.status === 'RUNNING'
      )
      const avgSuccessRate =
        totalExecutions > 0 ? (successfulRuns.length / totalExecutions) * 100 : 0

      const completedRuns = runs.filter((run) => run.status === 'SUCCEEDED' && run.finishedAt)
      const avgExecutionTime =
        completedRuns.length > 0
          ? completedRuns.reduce((sum, run) => {
              const duration = run.finishedAt!.getTime() - run.createdAt.getTime()
              return sum + duration
            }, 0) / completedRuns.length
          : 0

      return {
        workflowId,
        timeRange,
        dateRange: { from, to },
        executionsOverTime,
        tokenUsageOverTime,
        successRateOverTime,
        avgExecutionTimeOverTime,
        summary: {
          totalExecutions,
          totalTokens,
          avgSuccessRate,
          avgExecutionTime: Math.round(avgExecutionTime),
        },
      }
    } catch (error) {
      logger.error('Failed to fetch detailed workflow statistics', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        workflowId,
        organizationId,
      })
      throw error
    }
  }

  /**
   * Calculate date range and bucket type based on time range selection
   */
  private calculateDateRange(
    timeRange: DetailedTimeRange,
    customDateRange?: CustomDateRange
  ): { from: Date; to: Date; bucketType: 'hour' | 'day' | 'week' } {
    const now = new Date()
    let from: Date
    let to: Date = now
    let bucketType: 'hour' | 'day' | 'week' = 'day'

    if (timeRange === 'custom' && customDateRange) {
      from = customDateRange.from
      to = customDateRange.to
      // Determine bucket type based on range size
      const daysDiff = differenceInDays(to, from)
      if (daysDiff <= 7) {
        bucketType = 'hour'
      } else if (daysDiff <= 90) {
        bucketType = 'day'
      } else {
        bucketType = 'week'
      }
    } else {
      switch (timeRange) {
        case 'today':
          from = startOfDay(now)
          bucketType = 'hour'
          break
        case 'last7days':
          from = subDays(now, 7)
          bucketType = 'hour'
          break
        case 'last4weeks':
          from = subWeeks(now, 4)
          bucketType = 'day'
          break
        case 'last3months':
          from = subMonths(now, 3)
          bucketType = 'day'
          break
        case 'last12months':
          from = subMonths(now, 12)
          bucketType = 'week'
          break
        case 'monthToDate':
          from = startOfMonth(now)
          bucketType = 'day'
          break
        case 'quarterToDate':
          from = startOfQuarter(now)
          bucketType = 'day'
          break
        case 'yearToDate':
          from = startOfYear(now)
          bucketType = 'week'
          break
        case 'allTime':
          from = new Date('2020-01-01')
          bucketType = 'week'
          break
        default:
          from = subDays(now, 7)
          bucketType = 'hour'
      }
    }

    return { from, to, bucketType }
  }

  /**
   * Generate time buckets for the given date range
   */
  private generateTimeBuckets(from: Date, to: Date, bucketType: 'hour' | 'day' | 'week'): Date[] {
    switch (bucketType) {
      case 'hour':
        return eachHourOfInterval({ start: from, end: to })
      case 'day':
        return eachDayOfInterval({ start: from, end: to })
      case 'week':
        return eachWeekOfInterval({ start: from, end: to })
      default:
        return eachDayOfInterval({ start: from, end: to })
    }
  }

  /**
   * Aggregate execution counts by time buckets
   */
  private aggregateExecutions(
    runs: any[],
    timeBuckets: Date[],
    bucketType: 'hour' | 'day' | 'week'
  ): TimeSeriesDataPoint[] {
    return timeBuckets.map((bucket) => {
      const nextBucket = this.getNextBucket(bucket, bucketType)
      const runsInBucket = runs.filter(
        (run) => run.createdAt >= bucket && run.createdAt < nextBucket
      )

      return {
        timestamp: bucket,
        date: this.formatBucketDate(bucket, bucketType),
        value: runsInBucket.length,
      }
    })
  }

  /**
   * Aggregate token usage by time buckets
   */
  private aggregateTokenUsage(
    runs: any[],
    timeBuckets: Date[],
    bucketType: 'hour' | 'day' | 'week'
  ): TimeSeriesDataPoint[] {
    return timeBuckets.map((bucket) => {
      const nextBucket = this.getNextBucket(bucket, bucketType)
      const runsInBucket = runs.filter(
        (run) => run.createdAt >= bucket && run.createdAt < nextBucket
      )

      const totalTokens = runsInBucket.reduce((sum, run) => sum + (run.totalTokens || 0), 0)

      return {
        timestamp: bucket,
        date: this.formatBucketDate(bucket, bucketType),
        value: totalTokens,
      }
    })
  }

  /**
   * Aggregate success rate by time buckets
   */
  private aggregateSuccessRate(
    runs: any[],
    timeBuckets: Date[],
    bucketType: 'hour' | 'day' | 'week'
  ): TimeSeriesDataPoint[] {
    return timeBuckets.map((bucket) => {
      const nextBucket = this.getNextBucket(bucket, bucketType)
      const runsInBucket = runs.filter(
        (run) => run.createdAt >= bucket && run.createdAt < nextBucket
      )

      if (runsInBucket.length === 0) {
        return { timestamp: bucket, date: this.formatBucketDate(bucket, bucketType), value: 0 }
      }

      const successfulRuns = runsInBucket.filter(
        (run) => run.status === 'SUCCEEDED' || run.status === 'RUNNING'
      )
      const successRate = (successfulRuns.length / runsInBucket.length) * 100

      return {
        timestamp: bucket,
        date: this.formatBucketDate(bucket, bucketType),
        value: Math.round(successRate * 100) / 100, // Round to 2 decimal places
      }
    })
  }

  /**
   * Aggregate average execution time by time buckets
   */
  private aggregateExecutionTime(
    runs: any[],
    timeBuckets: Date[],
    bucketType: 'hour' | 'day' | 'week'
  ): TimeSeriesDataPoint[] {
    return timeBuckets.map((bucket) => {
      const nextBucket = this.getNextBucket(bucket, bucketType)
      const runsInBucket = runs.filter(
        (run) =>
          run.createdAt >= bucket &&
          run.createdAt < nextBucket &&
          run.status === 'SUCCEEDED' &&
          run.finishedAt
      )

      if (runsInBucket.length === 0) {
        return { timestamp: bucket, date: this.formatBucketDate(bucket, bucketType), value: 0 }
      }

      const avgExecutionTime =
        runsInBucket.reduce((sum, run) => {
          const duration = run.finishedAt!.getTime() - run.createdAt.getTime()
          return sum + duration
        }, 0) / runsInBucket.length

      return {
        timestamp: bucket,
        date: this.formatBucketDate(bucket, bucketType),
        value: Math.round(avgExecutionTime),
      }
    })
  }

  /**
   * Get the next bucket boundary
   */
  private getNextBucket(bucket: Date, bucketType: 'hour' | 'day' | 'week'): Date {
    switch (bucketType) {
      case 'hour':
        return addHours(bucket, 1)
      case 'day':
        return addDays(bucket, 1)
      case 'week':
        return addWeeks(bucket, 1)
      default:
        return addDays(bucket, 1)
    }
  }

  /**
   * Format bucket date for display
   */
  private formatBucketDate(bucket: Date, bucketType: 'hour' | 'day' | 'week'): string {
    switch (bucketType) {
      case 'hour':
        return format(bucket, 'MMM d, HH:mm')
      case 'day':
        return format(bucket, 'MMM d')
      case 'week':
        return format(bucket, 'MMM d')
      default:
        return format(bucket, 'MMM d')
    }
  }
}
