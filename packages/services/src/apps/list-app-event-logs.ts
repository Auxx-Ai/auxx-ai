// packages/services/src/apps/list-app-event-logs.ts

import { AppEventLog, database, Organization } from '@auxx/database'
import { and, desc, eq, gte, lte, or, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input parameters for listAppEventLogs
 */
export interface ListAppEventLogsInput {
  /** App ID to filter logs */
  appId: string
  /** Organization slug to resolve to organizationId */
  organizationSlug: string
  /** Optional app version ID filter */
  appVersionId?: string
  /** Optional start timestamp filter (inclusive) */
  startTimestamp?: Date
  /** Optional end timestamp filter (inclusive) */
  endTimestamp?: Date
  /** Optional search query for eventType and eventData */
  query?: string
  /** Optional cursor for pagination (ISO timestamp string) */
  cursor?: string
  /** Limit per page (default: 100, max: 300) */
  limit?: number
}

/**
 * App event log with all fields
 */
export interface AppEventLogItem {
  id: string
  appId: string
  organizationId: string
  appVersionId: string | null
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
 *
 * @param input - Filter and pagination parameters
 * @returns Result with app event logs, count, and pagination info
 */
export async function listAppEventLogs(input: ListAppEventLogsInput) {
  const {
    appId,
    organizationSlug,
    appVersionId,
    startTimestamp,
    endTimestamp,
    query,
    cursor,
    limit = 100,
  } = input

  // Validate and cap limit
  const cappedLimit = Math.min(Math.max(limit, 1), 300)

  // Step 1: Resolve organizationSlug to organizationId
  const orgResult = await fromDatabase(
    database.query.Organization.findFirst({
      where: (orgs, { eq }) => eq(orgs.handle, organizationSlug),
      columns: { id: true },
    }),
    'resolve-organization-slug'
  )

  if (orgResult.isErr()) {
    return orgResult
  }

  const organization = orgResult.value
  if (!organization) {
    return err({
      code: 'NOT_FOUND' as const,
      message: `Organization with slug "${organizationSlug}" not found`,
    })
  }

  const organizationId = organization.id

  // Step 2: Build where conditions
  const whereConditions = [
    eq(AppEventLog.appId, appId),
    eq(AppEventLog.organizationId, organizationId),
  ]

  // Add app version filter
  if (appVersionId) {
    whereConditions.push(eq(AppEventLog.appVersionId, appVersionId))
  }

  // Add cursor filter (timestamp < cursor for descending order)
  if (cursor) {
    const cursorDate = new Date(cursor)
    whereConditions.push(lte(AppEventLog.timestamp, cursorDate))
  }

  // Add timestamp range filters
  if (startTimestamp) {
    whereConditions.push(gte(AppEventLog.timestamp, startTimestamp))
  }

  if (endTimestamp) {
    whereConditions.push(lte(AppEventLog.timestamp, endTimestamp))
  }

  // Add query search filter (search in eventType and eventData)
  if (query) {
    whereConditions.push(
      or(
        sql`${AppEventLog.eventType} ILIKE ${`%${query}%`}`,
        sql`${AppEventLog.eventData}::text ILIKE ${`%${query}%`}`
      )!
    )
  }

  // Step 3: Fetch logs with limit + 1 to check hasMore
  const logsResult = await fromDatabase(
    database.query.AppEventLog.findMany({
      where: and(...whereConditions),
      orderBy: [desc(AppEventLog.timestamp)],
      limit: cappedLimit + 1,
    }),
    'list-app-event-logs'
  )

  if (logsResult.isErr()) {
    return logsResult
  }

  const logs = logsResult.value

  // Step 4: Calculate hasMore and slice to actual limit
  const hasMore = logs.length > cappedLimit
  const appEventLogs = hasMore ? logs.slice(0, cappedLimit) : logs

  // Step 5: Calculate nextCursor if hasMore
  const nextCursor =
    hasMore && appEventLogs.length > 0
      ? appEventLogs[appEventLogs.length - 1]!.timestamp.toISOString()
      : undefined

  // Step 6: Format response
  const formattedLogs: AppEventLogItem[] = appEventLogs.map((log) => ({
    id: log.id,
    appId: log.appId,
    organizationId: log.organizationId,
    appVersionId: log.appVersionId,
    userId: log.userId,
    eventType: log.eventType,
    eventData: log.eventData,
    requestMethod: log.requestMethod,
    requestPath: log.requestPath,
    responseStatus: log.responseStatus,
    durationMs: log.durationMs,
    timestamp: log.timestamp,
  }))

  return ok({
    appEventLogs: formattedLogs,
    hasMore,
    nextCursor,
  })
}
