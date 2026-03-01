// packages/services/src/apps/list-app-event-logs.ts

import { AppEventLog, database } from '@auxx/database'
import { and, desc, eq, gte, lte, or, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input parameters for listAppEventLogs
 */
export interface ListAppEventLogsInput {
  appId: string
  organizationSlug: string
  appDeploymentId?: string
  startTimestamp?: Date
  endTimestamp?: Date
  query?: string
  cursor?: string
  limit?: number
}

/**
 * App event log with all fields
 */
export interface AppEventLogItem {
  id: string
  appId: string
  organizationId: string
  appDeploymentId: string | null
  userId: string | null
  eventType: string
  eventData: any
  requestMethod: string | null
  requestPath: string | null
  responseStatus: number | null
  durationMs: number | null
  timestamp: Date
}

/**
 * Output for listAppEventLogs
 */
export interface ListAppEventLogsOutput {
  appEventLogs: AppEventLogItem[]
  hasMore: boolean
  nextCursor?: string
}

/**
 * List app event logs with filtering and cursor-based pagination
 */
export async function listAppEventLogs(input: ListAppEventLogsInput) {
  const {
    appId,
    organizationSlug,
    appDeploymentId,
    startTimestamp,
    endTimestamp,
    query,
    cursor,
    limit = 100,
  } = input

  const cappedLimit = Math.min(Math.max(limit, 1), 300)

  // Resolve organizationSlug to organizationId
  const orgResult = await fromDatabase(
    database.query.Organization.findFirst({
      where: (orgs, { eq }) => eq(orgs.handle, organizationSlug),
      columns: { id: true },
    }),
    'resolve-organization-slug'
  )

  if (orgResult.isErr()) return orgResult

  const organization = orgResult.value
  if (!organization) {
    return err({
      code: 'NOT_FOUND' as const,
      message: `Organization with slug "${organizationSlug}" not found`,
    })
  }

  const organizationId = organization.id

  // Build where conditions
  const whereConditions = [
    eq(AppEventLog.appId, appId),
    eq(AppEventLog.organizationId, organizationId),
  ]

  if (appDeploymentId) {
    whereConditions.push(eq(AppEventLog.appDeploymentId, appDeploymentId))
  }

  if (cursor) {
    whereConditions.push(lte(AppEventLog.timestamp, new Date(cursor)))
  }

  if (startTimestamp) {
    whereConditions.push(gte(AppEventLog.timestamp, startTimestamp))
  }

  if (endTimestamp) {
    whereConditions.push(lte(AppEventLog.timestamp, endTimestamp))
  }

  if (query) {
    whereConditions.push(
      or(
        sql`${AppEventLog.eventType} ILIKE ${`%${query}%`}`,
        sql`${AppEventLog.eventData}::text ILIKE ${`%${query}%`}`
      )!
    )
  }

  const logsResult = await fromDatabase(
    database.query.AppEventLog.findMany({
      where: and(...whereConditions),
      orderBy: [desc(AppEventLog.timestamp)],
      limit: cappedLimit + 1,
    }),
    'list-app-event-logs'
  )

  if (logsResult.isErr()) return logsResult

  const logs = logsResult.value
  const hasMore = logs.length > cappedLimit
  const appEventLogs = hasMore ? logs.slice(0, cappedLimit) : logs

  const nextCursor =
    hasMore && appEventLogs.length > 0
      ? appEventLogs[appEventLogs.length - 1]!.timestamp.toISOString()
      : undefined

  const formattedLogs: AppEventLogItem[] = appEventLogs.map((log) => ({
    id: log.id,
    appId: log.appId,
    organizationId: log.organizationId,
    appDeploymentId: log.appDeploymentId,
    userId: log.userId,
    eventType: log.eventType,
    eventData: log.eventData,
    requestMethod: log.requestMethod,
    requestPath: log.requestPath,
    responseStatus: log.responseStatus,
    durationMs: log.durationMs,
    timestamp: log.timestamp,
  }))

  return ok({ appEventLogs: formattedLogs, hasMore, nextCursor })
}
