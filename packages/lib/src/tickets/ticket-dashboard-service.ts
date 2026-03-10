// packages/lib/src/tickets/ticket-dashboard-service.ts

import { type Database, schema } from '@auxx/database'
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

/**
 * Type describing the supported dashboard summary periods
 */
export type TicketDashboardPeriod = 'day' | 'week' | 'month' | 'year'

/**
 * Arguments accepted by the dashboard summary query
 */
export interface TicketDashboardSummaryArgs {
  organizationId: string
  period?: TicketDashboardPeriod
}

/**
 * Structure returned by the dashboard summary query
 */
export interface TicketDashboardSummary {
  totalTickets: number
  ticketsByStatus: Record<string, number>
  newTicketsCount: number
  resolvedTicketsCount: number
  avgResolutionTime: number
  topTicketTypes: Array<{ type: string | null; count: number }>
  unassignedTicketsCount: number
  dueTodayCount: number
  overdueCount: number
  ticketsByPriority: Record<string, number>
  ticketsOverTime: Array<{ date: string; timestamp: number; created: number; resolved: number }>
}

/** Statuses that indicate a ticket is no longer active */
const TERMINAL_STATUSES = ['RESOLVED', 'CLOSED', 'CANCELLED', 'MERGED']

/**
 * Service responsible for computing ticket dashboard insights.
 *
 * Queries EntityInstance + FieldValue joins for ticket-specific fields
 * (status, priority, type, assignee, due date). Resolution timestamps
 * (resolvedAt, closedAt) are stored in EntityInstance.metadata.
 */
export class TicketDashboardService {
  constructor(private readonly db: Database) {}

  /**
   * Produce summary statistics used by the ticket dashboard.
   */
  async getSummary(args: TicketDashboardSummaryArgs): Promise<TicketDashboardSummary> {
    const period = args.period ?? 'week'
    const now = new Date()
    const startDate = this.calculatePeriodStart(period, now)
    const orgId = args.organizationId

    const entityDef = await this.getTicketEntityDefinition(orgId)
    if (!entityDef) {
      return this.emptyResult()
    }

    const fieldIds = await this.getTicketFieldIds(entityDef.id)

    // Base conditions for non-archived ticket instances in this org
    const baseConds = [
      eq(schema.EntityInstance.organizationId, orgId),
      eq(schema.EntityInstance.entityDefinitionId, entityDef.id),
      isNull(schema.EntityInstance.archivedAt),
    ]

    // Run independent queries in parallel
    const [
      totalTicketsRow,
      newTicketsRow,
      statusRows,
      priorityRows,
      typeRows,
      unassignedRow,
      dueTodayRow,
      overdueRow,
      resolvedRow,
      avgResRow,
      createdOverTime,
      resolvedOverTime,
    ] = await Promise.all([
      // Total tickets
      this.db
        .select({ cnt: count() })
        .from(schema.EntityInstance)
        .where(and(...baseConds))
        .then(([r]) => r),

      // New tickets in period
      this.db
        .select({ cnt: count() })
        .from(schema.EntityInstance)
        .where(and(...baseConds, gte(schema.EntityInstance.createdAt, startDate)))
        .then(([r]) => r),

      // Tickets by status
      fieldIds.ticket_status
        ? this.db
            .select({ status: schema.FieldValue.optionId, cnt: count() })
            .from(schema.EntityInstance)
            .innerJoin(
              schema.FieldValue,
              and(
                eq(schema.FieldValue.entityId, schema.EntityInstance.id),
                eq(schema.FieldValue.fieldId, fieldIds.ticket_status)
              )
            )
            .where(and(...baseConds))
            .groupBy(schema.FieldValue.optionId)
        : Promise.resolve([]),

      // Tickets by priority
      fieldIds.ticket_priority
        ? this.db
            .select({ priority: schema.FieldValue.optionId, cnt: count() })
            .from(schema.EntityInstance)
            .innerJoin(
              schema.FieldValue,
              and(
                eq(schema.FieldValue.entityId, schema.EntityInstance.id),
                eq(schema.FieldValue.fieldId, fieldIds.ticket_priority)
              )
            )
            .where(and(...baseConds))
            .groupBy(schema.FieldValue.optionId)
        : Promise.resolve([]),

      // Top ticket types
      fieldIds.ticket_type
        ? this.db
            .select({ type: schema.FieldValue.optionId, cnt: count() })
            .from(schema.EntityInstance)
            .innerJoin(
              schema.FieldValue,
              and(
                eq(schema.FieldValue.entityId, schema.EntityInstance.id),
                eq(schema.FieldValue.fieldId, fieldIds.ticket_type)
              )
            )
            .where(and(...baseConds))
            .groupBy(schema.FieldValue.optionId)
            .orderBy(desc(count()))
            .limit(5)
        : Promise.resolve([]),

      // Unassigned tickets
      fieldIds.assigned_to_id
        ? this.db
            .select({ cnt: count() })
            .from(schema.EntityInstance)
            .leftJoin(
              schema.FieldValue,
              and(
                eq(schema.FieldValue.entityId, schema.EntityInstance.id),
                eq(schema.FieldValue.fieldId, fieldIds.assigned_to_id)
              )
            )
            .where(
              and(...baseConds, or(isNull(schema.FieldValue.id), isNull(schema.FieldValue.actorId)))
            )
            .then(([r]) => r)
        : this.db
            .select({ cnt: count() })
            .from(schema.EntityInstance)
            .where(and(...baseConds))
            .then(([r]) => r),

      // Due today
      fieldIds.due_date
        ? (() => {
            const todayStart = new Date()
            todayStart.setHours(0, 0, 0, 0)
            const todayEnd = new Date()
            todayEnd.setHours(23, 59, 59, 999)
            return this.db
              .select({ cnt: count() })
              .from(schema.EntityInstance)
              .innerJoin(
                schema.FieldValue,
                and(
                  eq(schema.FieldValue.entityId, schema.EntityInstance.id),
                  eq(schema.FieldValue.fieldId, fieldIds.due_date)
                )
              )
              .where(
                and(
                  ...baseConds,
                  gte(schema.FieldValue.valueDate, todayStart.toISOString()),
                  lte(schema.FieldValue.valueDate, todayEnd.toISOString())
                )
              )
              .then(([r]) => r)
          })()
        : Promise.resolve({ cnt: 0 }),

      // Overdue (due_date < today AND not terminal status)
      fieldIds.due_date && fieldIds.ticket_status
        ? (() => {
            const todayStart = new Date()
            todayStart.setHours(0, 0, 0, 0)
            const fvDue = schema.FieldValue
            // We need a second alias for the status field value join
            // Use a subquery approach instead
            return this.db
              .select({ cnt: count() })
              .from(schema.EntityInstance)
              .innerJoin(
                schema.FieldValue,
                and(
                  eq(schema.FieldValue.entityId, schema.EntityInstance.id),
                  eq(schema.FieldValue.fieldId, fieldIds.due_date)
                )
              )
              .where(
                and(
                  ...baseConds,
                  lt(schema.FieldValue.valueDate, todayStart.toISOString()),
                  // Exclude terminal statuses via subquery
                  sql`${schema.EntityInstance.id} NOT IN (
                    SELECT ${schema.FieldValue.entityId} FROM ${schema.FieldValue}
                    WHERE ${schema.FieldValue.fieldId} = ${fieldIds.ticket_status}
                    AND ${schema.FieldValue.optionId} IN (${sql.join(
                      TERMINAL_STATUSES.map((s) => sql`${s}`),
                      sql`, `
                    )})
                  )`
                )
              )
              .then(([r]) => r)
          })()
        : Promise.resolve({ cnt: 0 }),

      // Resolved tickets in period (status IN terminal + resolution timestamp in period)
      fieldIds.ticket_status
        ? this.db
            .select({ cnt: count() })
            .from(schema.EntityInstance)
            .innerJoin(
              schema.FieldValue,
              and(
                eq(schema.FieldValue.entityId, schema.EntityInstance.id),
                eq(schema.FieldValue.fieldId, fieldIds.ticket_status)
              )
            )
            .where(
              and(
                ...baseConds,
                inArray(schema.FieldValue.optionId, ['RESOLVED', 'CLOSED']),
                sql`COALESCE(
                  (${schema.EntityInstance.metadata}->>'closedAt')::timestamp,
                  (${schema.EntityInstance.metadata}->>'resolvedAt')::timestamp
                ) >= ${startDate}`,
                sql`COALESCE(
                  (${schema.EntityInstance.metadata}->>'closedAt')::timestamp,
                  (${schema.EntityInstance.metadata}->>'resolvedAt')::timestamp
                ) <= ${now}`
              )
            )
            .then(([r]) => r)
        : Promise.resolve({ cnt: 0 }),

      // Average resolution time (ms)
      this.db
        .select({
          avgMs: sql<number>`AVG(
            EXTRACT(EPOCH FROM (
              COALESCE(
                (${schema.EntityInstance.metadata}->>'closedAt')::timestamp,
                (${schema.EntityInstance.metadata}->>'resolvedAt')::timestamp
              ) - ${schema.EntityInstance.createdAt}
            )) * 1000
          )`,
        })
        .from(schema.EntityInstance)
        .where(
          and(
            ...baseConds,
            gte(schema.EntityInstance.createdAt, startDate),
            sql`COALESCE(
              (${schema.EntityInstance.metadata}->>'closedAt')::timestamp,
              (${schema.EntityInstance.metadata}->>'resolvedAt')::timestamp
            ) IS NOT NULL`
          )
        )
        .then(([r]) => r),

      // Created over time
      this.queryTimeBuckets(entityDef.id, orgId, startDate, now, period, 'created'),

      // Resolved over time
      this.queryTimeBuckets(entityDef.id, orgId, startDate, now, period, 'resolved'),
    ])

    // Build ticketsByStatus record
    const ticketsByStatus: Record<string, number> = {}
    for (const row of statusRows) {
      if (row.status) ticketsByStatus[row.status] = Number(row.cnt)
    }

    // Build ticketsByPriority record
    const ticketsByPriority: Record<string, number> = {}
    for (const row of priorityRows) {
      if (row.priority) ticketsByPriority[row.priority] = Number(row.cnt)
    }

    // Build topTicketTypes
    const topTicketTypes = typeRows.map((row) => ({
      type: row.type ?? 'Unknown',
      count: Number(row.cnt),
    }))

    // Merge time series
    const ticketsOverTime = this.mergeTimeSeries(
      period,
      startDate,
      now,
      createdOverTime,
      resolvedOverTime
    )

    return {
      totalTickets: Number(totalTicketsRow?.cnt || 0),
      ticketsByStatus,
      newTicketsCount: Number(newTicketsRow?.cnt || 0),
      resolvedTicketsCount: Number(resolvedRow?.cnt || 0),
      avgResolutionTime: Number(avgResRow?.avgMs || 0),
      topTicketTypes,
      unassignedTicketsCount: Number(unassignedRow?.cnt || 0),
      dueTodayCount: Number(dueTodayRow?.cnt || 0),
      overdueCount: Number(overdueRow?.cnt || 0),
      ticketsByPriority,
      ticketsOverTime,
    }
  }

  /**
   * Look up CustomField IDs for the ticket system attributes we need.
   */
  private async getTicketFieldIds(entityDefinitionId: string) {
    const fields = await this.db
      .select({
        id: schema.CustomField.id,
        systemAttribute: schema.CustomField.systemAttribute,
      })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
          inArray(schema.CustomField.systemAttribute, [
            'ticket_status',
            'ticket_priority',
            'ticket_type',
            'assigned_to_id',
            'due_date',
          ])
        )
      )

    return Object.fromEntries(fields.map((f) => [f.systemAttribute!, f.id])) as Record<
      'ticket_status' | 'ticket_priority' | 'ticket_type' | 'assigned_to_id' | 'due_date',
      string | undefined
    >
  }

  /**
   * Look up the EntityDefinition for ticket entities in this organization
   */
  private async getTicketEntityDefinition(organizationId: string) {
    const rows = await this.db
      .select()
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'ticket')
        )
      )
      .limit(1)
    return rows[0] ?? null
  }

  /**
   * Query time-bucketed counts for created or resolved tickets.
   */
  private async queryTimeBuckets(
    entityDefinitionId: string,
    orgId: string,
    startDate: Date,
    endDate: Date,
    period: TicketDashboardPeriod,
    mode: 'created' | 'resolved'
  ): Promise<Array<{ bucket: string; cnt: number }>> {
    const truncUnitStr = period === 'day' ? 'hour' : period === 'year' ? 'month' : 'day'
    const truncUnit = sql.raw(`'${truncUnitStr}'`)

    if (mode === 'created') {
      const rows = await this.db
        .select({
          bucket: sql<string>`date_trunc(${truncUnit}, ${schema.EntityInstance.createdAt})::text`,
          cnt: count(),
        })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.organizationId, orgId),
            eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
            isNull(schema.EntityInstance.archivedAt),
            gte(schema.EntityInstance.createdAt, startDate),
            lte(schema.EntityInstance.createdAt, endDate)
          )
        )
        .groupBy(sql`date_trunc(${truncUnit}, ${schema.EntityInstance.createdAt})`)
      return rows.map((r) => ({ bucket: r.bucket, cnt: Number(r.cnt) }))
    }

    // Resolved: use metadata timestamps
    const resolvedAtExpr = sql`COALESCE(
      (${schema.EntityInstance.metadata}->>'closedAt')::timestamp,
      (${schema.EntityInstance.metadata}->>'resolvedAt')::timestamp
    )`

    const rows = await this.db
      .select({
        bucket: sql<string>`date_trunc(${truncUnit}, ${resolvedAtExpr})::text`,
        cnt: count(),
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, orgId),
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
          isNull(schema.EntityInstance.archivedAt),
          sql`${resolvedAtExpr} >= ${startDate}`,
          sql`${resolvedAtExpr} <= ${endDate}`
        )
      )
      .groupBy(sql`date_trunc(${truncUnit}, ${resolvedAtExpr})`)
    return rows.map((r) => ({ bucket: r.bucket, cnt: Number(r.cnt) }))
  }

  /**
   * Merge created/resolved time bucket data into the time series format.
   */
  private mergeTimeSeries(
    period: TicketDashboardPeriod,
    startDate: Date,
    endDate: Date,
    createdBuckets: Array<{ bucket: string; cnt: number }>,
    resolvedBuckets: Array<{ bucket: string; cnt: number }>
  ): Array<{ date: string; timestamp: number; created: number; resolved: number }> {
    const intervalConfig = this.resolveInterval(period)
    const intervals: Date[] = []
    let currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      intervals.push(new Date(currentDate))
      currentDate = new Date(currentDate.getTime() + intervalConfig.intervalMs)
    }

    // Index bucket data by truncated timestamp for fast lookup
    const createdMap = new Map<number, number>()
    for (const b of createdBuckets) {
      const ts = new Date(b.bucket).getTime()
      createdMap.set(ts, b.cnt)
    }

    const resolvedMap = new Map<number, number>()
    for (const b of resolvedBuckets) {
      const ts = new Date(b.bucket).getTime()
      resolvedMap.set(ts, b.cnt)
    }

    // For matching, truncate each interval date to the same granularity
    const truncate = (d: Date): number => {
      const t = new Date(d)
      if (period === 'day') {
        t.setMinutes(0, 0, 0)
      } else if (period === 'year') {
        t.setDate(1)
        t.setHours(0, 0, 0, 0)
      } else {
        t.setHours(0, 0, 0, 0)
      }
      return t.getTime()
    }

    return intervals.map((intervalDate) => {
      const ts = truncate(intervalDate)
      return {
        date: this.formatIntervalLabel(intervalDate, intervalConfig.dateFormat),
        timestamp: intervalDate.getTime(),
        created: createdMap.get(ts) ?? 0,
        resolved: resolvedMap.get(ts) ?? 0,
      }
    })
  }

  /**
   * Determine the start date for the given summary period
   */
  private calculatePeriodStart(period: TicketDashboardPeriod, reference: Date): Date {
    const startDate = new Date(reference)
    switch (period) {
      case 'day':
        startDate.setHours(0, 0, 0, 0)
        break
      case 'week':
        startDate.setDate(reference.getDate() - 7)
        break
      case 'month':
        startDate.setMonth(reference.getMonth() - 1)
        break
      case 'year':
        startDate.setFullYear(reference.getFullYear() - 1)
        break
      default:
        startDate.setDate(reference.getDate() - 7)
        break
    }
    return startDate
  }

  /**
   * Resolve the aggregation interval configuration for the selected period
   */
  private resolveInterval(period: TicketDashboardPeriod) {
    switch (period) {
      case 'day':
        return { dateFormat: 'hour' as const, intervalMs: 3600 * 1000 }
      case 'week':
        return { dateFormat: 'day' as const, intervalMs: 24 * 3600 * 1000 }
      case 'month':
        return { dateFormat: 'day' as const, intervalMs: 24 * 3600 * 1000 }
      case 'year':
        return { dateFormat: 'month' as const, intervalMs: 30 * 24 * 3600 * 1000 }
      default:
        return { dateFormat: 'day' as const, intervalMs: 24 * 3600 * 1000 }
    }
  }

  /**
   * Produce a human-readable label for a time-series interval
   */
  private formatIntervalLabel(date: Date, format: 'hour' | 'day' | 'week' | 'month') {
    switch (format) {
      case 'hour':
        return `${date.getHours()}:00`
      case 'day':
        return `${date.getMonth() + 1}/${date.getDate()}`
      case 'week': {
        const weekNumber = Math.ceil(
          (date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7
        )
        return `Week ${weekNumber}`
      }
      case 'month': {
        return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date)
      }
      default:
        return `${date.getMonth() + 1}/${date.getDate()}`
    }
  }

  /** Return an empty dashboard result */
  private emptyResult(): TicketDashboardSummary {
    return {
      totalTickets: 0,
      ticketsByStatus: {},
      newTicketsCount: 0,
      resolvedTicketsCount: 0,
      avgResolutionTime: 0,
      topTicketTypes: [],
      unassignedTicketsCount: 0,
      dueTodayCount: 0,
      overdueCount: 0,
      ticketsByPriority: {},
      ticketsOverTime: [],
    }
  }
}

/**
 * Factory helper to create a dashboard service instance for the provided database
 */
export function createTicketDashboardService(db: Database) {
  return new TicketDashboardService(db)
}
