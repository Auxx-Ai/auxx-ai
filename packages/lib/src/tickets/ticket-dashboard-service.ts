// packages/lib/src/tickets/ticket-dashboard-service.ts

import { schema, type Database } from '@auxx/database'
import { TicketStatus as TicketStatusEnum } from '@auxx/database/enums'
import { and, asc, count, eq, gte, inArray, isNull, lt, lte, not } from 'drizzle-orm'

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
 * Service responsible for computing ticket dashboard insights
 */
export class TicketDashboardService {
  constructor(private readonly db: Database) {}

  /**
   * Produce summary statistics used by the ticket dashboard
   */
  async getSummary(args: TicketDashboardSummaryArgs): Promise<TicketDashboardSummary> {
    const period = args.period ?? 'week'
    const now = new Date()
    const startDate = this.calculatePeriodStart(period, now)

    const ticketsByStatusRows = await this.db
      .select({ status: schema.Ticket.status, cnt: count() })
      .from(schema.Ticket)
      .where(eq(schema.Ticket.organizationId, args.organizationId))
      .groupBy(schema.Ticket.status)

    const ticketsByStatus = ticketsByStatusRows.map((row) => ({
      status: row.status,
      count: Number(row.cnt || 0),
    }))

    const [{ newCount }] = await this.db
      .select({ newCount: count() })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.organizationId, args.organizationId),
          gte(schema.Ticket.createdAt, startDate)
        )
      )

    const [{ resCount }] = await this.db
      .select({ resCount: count() })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.organizationId, args.organizationId),
          inArray(schema.Ticket.status, [TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED]),
          gte(schema.Ticket.resolvedAt, startDate)
        )
      )

    const resolvedTickets = await this.db
      .select({ createdAt: schema.Ticket.createdAt, resolvedAt: schema.Ticket.resolvedAt })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.organizationId, args.organizationId),
          inArray(schema.Ticket.status, [TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED]),
          gte(schema.Ticket.resolvedAt, startDate)
        )
      )

    const resolutionTimes = resolvedTickets
      .map((ticket) =>
        ticket.resolvedAt ? ticket.resolvedAt.getTime() - ticket.createdAt.getTime() : 0
      )
      .filter((duration) => duration > 0)

    const avgResolutionTime =
      resolutionTimes.length > 0
        ? resolutionTimes.reduce((acc, duration) => acc + duration, 0) / resolutionTimes.length
        : 0

    const ticketTypesRows = await this.db
      .select({ type: schema.Ticket.type, cnt: count() })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.organizationId, args.organizationId),
          gte(schema.Ticket.createdAt, startDate)
        )
      )
      .groupBy(schema.Ticket.type)

    const topTicketTypes = ticketTypesRows
      .map((row) => ({ type: row.type, count: Number(row.cnt || 0) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    const unassignedRows = await this.db
      .select({ id: schema.Ticket.id })
      .from(schema.Ticket)
      .leftJoin(schema.TicketAssignment, eq(schema.Ticket.id, schema.TicketAssignment.ticketId))
      .where(
        and(
          eq(schema.Ticket.organizationId, args.organizationId),
          isNull(schema.TicketAssignment.id),
          not(
            inArray(schema.Ticket.status, [
              TicketStatusEnum.RESOLVED,
              TicketStatusEnum.CLOSED,
              TicketStatusEnum.CANCELLED,
            ])
          )
        )
      )

    const today = new Date()
    today.setHours(23, 59, 59, 999)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [{ dueToday }] = await this.db
      .select({ dueToday: count() })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.organizationId, args.organizationId),
          gte(schema.Ticket.dueDate, todayStart),
          lte(schema.Ticket.dueDate, today),
          not(
            inArray(schema.Ticket.status, [
              TicketStatusEnum.RESOLVED,
              TicketStatusEnum.CLOSED,
              TicketStatusEnum.CANCELLED,
            ])
          )
        )
      )

    const [{ overdue }] = await this.db
      .select({ overdue: count() })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.organizationId, args.organizationId),
          lt(schema.Ticket.dueDate, todayStart),
          not(
            inArray(schema.Ticket.status, [
              TicketStatusEnum.RESOLVED,
              TicketStatusEnum.CLOSED,
              TicketStatusEnum.CANCELLED,
            ])
          )
        )
      )

    const ticketsByPriorityRows = await this.db
      .select({ priority: schema.Ticket.priority, cnt: count() })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.organizationId, args.organizationId),
          not(
            inArray(schema.Ticket.status, [
              TicketStatusEnum.RESOLVED,
              TicketStatusEnum.CLOSED,
              TicketStatusEnum.CANCELLED,
            ])
          )
        )
      )
      .groupBy(schema.Ticket.priority)

    const ticketsOverTime = await this.getTicketsOverTime(
      args.organizationId,
      period,
      startDate,
      now
    )

    const ticketsByStatusRecord = ticketsByStatus.reduce<Record<string, number>>(
      (acc, item) => {
        acc[item.status ?? 'UNKNOWN'] = item.count
        return acc
      },
      {}
    )

    const ticketsByPriorityRecord = ticketsByPriorityRows.reduce<Record<string, number>>(
      (acc, item) => {
        acc[item.priority ?? 'UNKNOWN'] = Number(item.cnt || 0)
        return acc
      },
      {}
    )

    return {
      totalTickets: ticketsByStatus.reduce((sum, item) => sum + item.count, 0),
      ticketsByStatus: ticketsByStatusRecord,
      newTicketsCount: Number(newCount || 0),
      resolvedTicketsCount: Number(resCount || 0),
      avgResolutionTime,
      topTicketTypes,
      unassignedTicketsCount: unassignedRows.length,
      dueTodayCount: Number(dueToday || 0),
      overdueCount: Number(overdue || 0),
      ticketsByPriority: ticketsByPriorityRecord,
      ticketsOverTime,
    }
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
   * Build a time series of ticket creation and resolution activity
   */
  private async getTicketsOverTime(
    organizationId: string,
    period: TicketDashboardPeriod,
    startDate: Date,
    endDate: Date
  ) {
    const tickets = await this.db
      .select({
        id: schema.Ticket.id,
        createdAt: schema.Ticket.createdAt,
        resolvedAt: schema.Ticket.resolvedAt,
        status: schema.Ticket.status,
      })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.organizationId, organizationId),
          gte(schema.Ticket.createdAt, startDate),
          lte(schema.Ticket.createdAt, endDate)
        )
      )
      .orderBy(asc(schema.Ticket.createdAt))

    const intervalConfig = this.resolveInterval(period)

    const intervals: Date[] = []
    let currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      intervals.push(new Date(currentDate))
      currentDate = new Date(currentDate.getTime() + intervalConfig.intervalMs)
    }

    return intervals.map((intervalDate) => {
      const nextIntervalDate = new Date(intervalDate.getTime() + intervalConfig.intervalMs)
      const created = tickets.filter(
        (ticket) => ticket.createdAt >= intervalDate && ticket.createdAt < nextIntervalDate
      ).length
      const resolved = tickets.filter(
        (ticket) =>
          ticket.resolvedAt !== null &&
          ticket.resolvedAt >= intervalDate &&
          ticket.resolvedAt < nextIntervalDate
      ).length

      return {
        date: this.formatIntervalLabel(intervalDate, intervalConfig.dateFormat),
        timestamp: intervalDate.getTime(),
        created,
        resolved,
      }
    })
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
