// packages/lib/src/tickets/ticket-dashboard-service.ts

import { type Database, schema } from '@auxx/database'
import { and, count, eq, gte, isNull, lte } from 'drizzle-orm'

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

/**
 * Service responsible for computing ticket dashboard insights.
 *
 * Queries EntityInstance + EntityDefinition (where entityType = 'ticket')
 * instead of the dropped Ticket table. Field values for ticket-specific
 * fields (status, priority, etc.) live in the FieldValue table.
 *
 * TODO: Reimplement dashboard queries using EntityInstance + FieldValue joins.
 * The old implementation relied heavily on typed columns on the Ticket table
 * (status, priority, type, resolvedAt, closedAt, dueDate). These are now
 * stored as FieldValue rows, requiring a different query strategy.
 */
export class TicketDashboardService {
  constructor(private readonly db: Database) {}

  /**
   * Produce summary statistics used by the ticket dashboard.
   * Currently returns empty/default values -- awaiting FieldValue-based query rewrite.
   */
  async getSummary(args: TicketDashboardSummaryArgs): Promise<TicketDashboardSummary> {
    const period = args.period ?? 'week'
    const now = new Date()
    const startDate = this.calculatePeriodStart(period, now)

    // Count total ticket entity instances for this organization
    const entityDef = await this.getTicketEntityDefinition(args.organizationId)
    let totalTickets = 0

    if (entityDef) {
      const [row] = await this.db
        .select({ cnt: count() })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.organizationId, args.organizationId),
            eq(schema.EntityInstance.entityDefinitionId, entityDef.id),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
      totalTickets = Number(row?.cnt || 0)

      // Count new tickets in period
      const [newRow] = await this.db
        .select({ cnt: count() })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.organizationId, args.organizationId),
            eq(schema.EntityInstance.entityDefinitionId, entityDef.id),
            gte(schema.EntityInstance.createdAt, startDate)
          )
        )

      return {
        totalTickets,
        ticketsByStatus: {},
        newTicketsCount: Number(newRow?.cnt || 0),
        resolvedTicketsCount: 0, // TODO: Query FieldValue for status = RESOLVED/CLOSED
        avgResolutionTime: 0, // TODO: Requires resolvedAt from FieldValue
        topTicketTypes: [], // TODO: Query FieldValue for ticket_type grouping
        unassignedTicketsCount: 0, // TODO: Query FieldValue for assigned_to_id IS NULL
        dueTodayCount: 0, // TODO: Query FieldValue for due_date
        overdueCount: 0, // TODO: Query FieldValue for due_date
        ticketsByPriority: {},
        ticketsOverTime: this.generateEmptyTimeSeries(period, startDate, now),
      }
    }

    // No ticket entity definition found, return defaults
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
   * Generate an empty time series for the given period
   */
  private generateEmptyTimeSeries(
    period: TicketDashboardPeriod,
    startDate: Date,
    endDate: Date
  ): Array<{ date: string; timestamp: number; created: number; resolved: number }> {
    const intervalConfig = this.resolveInterval(period)
    const intervals: Date[] = []
    let currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      intervals.push(new Date(currentDate))
      currentDate = new Date(currentDate.getTime() + intervalConfig.intervalMs)
    }
    return intervals.map((intervalDate) => ({
      date: this.formatIntervalLabel(intervalDate, intervalConfig.dateFormat),
      timestamp: intervalDate.getTime(),
      created: 0,
      resolved: 0,
    }))
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
}

/**
 * Factory helper to create a dashboard service instance for the provided database
 */
export function createTicketDashboardService(db: Database) {
  return new TicketDashboardService(db)
}
