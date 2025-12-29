// src/lib/mail-query/mail-view-query-builder.ts
import {
  eq,
  and,
  or,
  inArray,
  ilike,
  isNull,
  isNotNull,
  exists,
  gt,
  gte,
  lt,
  lte,
  not,
  type SQL,
} from 'drizzle-orm'
import {
  Thread,
  LabelsOnThread,
  Message,
  MessageParticipant,
  Participant,
} from '@auxx/database/models'
import { ThreadStatusValues } from '@auxx/database/enums'
import { type ThreadStatus } from '@auxx/database/types'
import { database as db, schema } from '@auxx/database'

import { createScopedLogger } from '../logger'
import {
  ComparisonOperator,
  ConditionType,
  type FilterCondition,
  type MailViewFilter,
  type TeamMember,
} from './types'

// Enums for filter structure
/**
 * Query builder for translating mail view filter structures into drizzle WHERE conditions for Threads.
 */
export class MailViewQueryBuilder {
  private filter: MailViewFilter
  private organizationId: string
  private logger: ReturnType<typeof createScopedLogger> // Use inferred type

  /**
   * Create a new MailViewQueryBuilder.
   * @param filter The filter structure to transform.
   * @param organizationId The organization ID for context scoping.
   */
  constructor(filter: MailViewFilter, organizationId: string) {
    // Basic validation of input filter structure
    if (
      !filter ||
      typeof filter !== 'object' ||
      !filter.operator ||
      !Array.isArray(filter.conditions)
    ) {
      throw new Error('Invalid MailViewFilter structure provided to MailViewQueryBuilder.')
    }
    this.filter = filter
    this.organizationId = organizationId
    this.logger = createScopedLogger('mail-view-query-builder')
  }

  /**
   * Build the Drizzle WHERE condition based on the mail view filters.
   * Note: Organization ID filtering should be applied by the calling service.
   * @returns Drizzle SQL condition for Thread queries.
   */
  buildWhereCondition(): SQL<unknown> {
    this.logger.info('Building where condition from MailViewFilter', {
      filterCount: this.filter.conditions?.length || 0,
      operator: this.filter.operator,
      // organizationId: this.organizationId, // Org ID applied externally
    })

    // Process the top-level filter group
    const filterConditions = this.processFilterGroup(this.filter)

    // The service calling this builder should combine the result with organizationId filtering
    return filterConditions
  }

  /**
   * Recursively process a filter group (AND/OR group of conditions).
   * @param group The filter group to process.
   * @returns Drizzle SQL condition for the group.
   */
  private processFilterGroup(group: MailViewFilter): SQL<unknown> {
    // Use Drizzle's and/or operators
    const operatorKey = group.operator // Should be 'AND' or 'OR'

    const conditions: SQL<unknown>[] = []

    for (const item of group.conditions) {
      let processedCondition: SQL<unknown> | null = null

      // Check if it's a nested group (duck typing by checking for 'conditions' array)
      if (
        item &&
        typeof item === 'object' &&
        'conditions' in item &&
        Array.isArray(item.conditions) &&
        'operator' in item
      ) {
        processedCondition = this.processFilterGroup(item as MailViewFilter)
      }
      // Check if it's a simple condition
      else if (
        item &&
        typeof item === 'object' &&
        'type' in item &&
        'operator' in item
        // 'value' is handled within processCondition as it might be null intentionally
      ) {
        processedCondition = this.processCondition(item as FilterCondition)
      } else {
        this.logger.warn('Skipping invalid item in filter group conditions', { item })
      }

      // Add the processed condition only if it's valid
      if (processedCondition) {
        conditions.push(processedCondition)
      }
    }

    // Handle the results for the group
    if (conditions.length === 0) {
      // Return a condition that matches everything (effectively TRUE)
      return eq(Thread.id, Thread.id)
    }
    if (conditions.length === 1) {
      return conditions[0] // A single condition doesn't need the AND/OR wrapper
    }
    // Multiple conditions require the AND/OR wrapper
    return operatorKey === 'AND' ? and(...conditions)! : or(...conditions)!
  }

  /**
   * Process a single filter condition, routing to specific builder methods.
   * @param condition The filter condition to process.
   * @returns Drizzle SQL condition for the condition or null if invalid.
   */
  private processCondition(condition: FilterCondition): SQL<unknown> | null {
    // Basic validation
    if (!condition.type || !condition.operator) {
      this.logger.warn('Skipping condition with missing type or operator', { condition })
      return null
    }
    try {
      switch (condition.type) {
        // case ConditionType.INTEGRATION: // Removed
        //   return this.buildIntegrationCondition(condition);
        case ConditionType.TAG:
          return this.buildTagCondition(condition)
        case ConditionType.LABEL:
          return this.buildLabelCondition(condition)
        case ConditionType.ASSIGNEE:
          return this.buildAssigneeCondition(condition)
        case ConditionType.STATUS:
          return this.buildStatusCondition(condition)
        case ConditionType.DATE:
          return this.buildDateCondition(condition)
        case ConditionType.SENDER:
          return this.buildSenderCondition(condition)
        case ConditionType.SUBJECT:
          return this.buildSubjectCondition(condition)
        case ConditionType.INBOX:
          return this.buildInboxCondition(condition)
        default:
          // Log unknown types but don't throw, just ignore the condition
          this.logger.warn('Unknown condition type encountered', {
            type: condition.type,
            condition,
          })
          return null
      }
    } catch (error: any) {
      this.logger.error(`Error processing condition type ${condition.type}`, {
        error: error.message,
        condition,
        stack: error.stack,
      })
      return null // Return null on error to avoid breaking the entire query structure
    }
  }

  // --- Condition Builder Methods ---

  private buildTagCondition(condition: FilterCondition): SQL<unknown> | null {
    const { operator, value } = condition

    // Handle IS_EMPTY / IS_NOT_EMPTY first
    if (operator === ComparisonOperator.IS_EMPTY) {
      // No associated tags - use NOT EXISTS
      return not(
        exists(
          db
            .select()
            .from(schema.TagsOnThread)
            .where(eq(schema.TagsOnThread.threadId, schema.Thread.id))
        )
      )
    }
    if (operator === ComparisonOperator.IS_NOT_EMPTY) {
      // At least one associated tag - use EXISTS
      return exists(
        db
          .select()
          .from(schema.TagsOnThread)
          .where(eq(schema.TagsOnThread.threadId, schema.Thread.id))
      )
    }

    // Validate value for other operators
    if (value === null || typeof value === 'undefined') {
      this.logger.warn(`Missing tag value for operator ${operator}`, { condition })
      return null
    }

    const tagId = value as string
    const tagIds = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [tagId].filter((v): v is string => typeof v === 'string')

    if (tagIds.length === 0 && value !== null) {
      this.logger.warn('Invalid tag ID(s) provided', { value })
      return null
    }

    switch (operator) {
      case ComparisonOperator.EQUALS: // Interpreted as "has this tag"
        if (Array.isArray(value)) {
          this.logger.warn(`EQUALS operator used with array value for TAG, interpreting as IN`, {
            value,
          })
          return exists(
            db
              .select()
              .from(schema.TagsOnThread)
              .where(
                and(
                  eq(schema.TagsOnThread.threadId, schema.Thread.id),
                  inArray(schema.TagsOnThread.tagId, tagIds)
                )
              )
          )
        }
        return exists(
          db
            .select()
            .from(schema.TagsOnThread)
            .where(
              and(
                eq(schema.TagsOnThread.threadId, schema.Thread.id),
                eq(schema.TagsOnThread.tagId, tagId)
              )
            )
        )
      case ComparisonOperator.NOT_EQUALS: // Interpreted as "does not have this tag"
        if (Array.isArray(value)) {
          this.logger.warn(
            `NOT_EQUALS operator used with array value for TAG, interpreting as NOT_IN`,
            { value }
          )
          return not(
            exists(
              db
                .select()
                .from(schema.TagsOnThread)
                .where(
                  and(
                    eq(schema.TagsOnThread.threadId, schema.Thread.id),
                    inArray(schema.TagsOnThread.tagId, tagIds)
                  )
                )
            )
          )
        }
        return not(
          exists(
            db
              .select()
              .from(schema.TagsOnThread)
              .where(
                and(
                  eq(schema.TagsOnThread.threadId, schema.Thread.id),
                  eq(schema.TagsOnThread.tagId, tagId)
                )
              )
          )
        )
      case ComparisonOperator.IN:
        if (!Array.isArray(value)) {
          this.logger.warn(`IN operator requires an array value for TAG`, { value })
          return exists(
            db
              .select()
              .from(schema.TagsOnThread)
              .where(
                and(
                  eq(schema.TagsOnThread.threadId, schema.Thread.id),
                  eq(schema.TagsOnThread.tagId, tagId)
                )
              )
          ) // Fallback to single tag check
        }
        return exists(
          db
            .select()
            .from(schema.TagsOnThread)
            .where(
              and(
                eq(schema.TagsOnThread.threadId, schema.Thread.id),
                inArray(schema.TagsOnThread.tagId, tagIds)
              )
            )
        ) // Has at least one of the tags
      case ComparisonOperator.NOT_IN:
        if (!Array.isArray(value)) {
          this.logger.warn(`NOT_IN operator requires an array value for TAG`, { value })
          return not(
            exists(
              db
                .select()
                .from(schema.TagsOnThread)
                .where(
                  and(
                    eq(schema.TagsOnThread.threadId, schema.Thread.id),
                    eq(schema.TagsOnThread.tagId, tagId)
                  )
                )
            )
          ) // Fallback to single tag check
        }
        return not(
          exists(
            db
              .select()
              .from(schema.TagsOnThread)
              .where(
                and(
                  eq(schema.TagsOnThread.threadId, schema.Thread.id),
                  inArray(schema.TagsOnThread.tagId, tagIds)
                )
              )
          )
        ) // Has none of the specified tags
      default:
        this.logger.warn(`Unsupported operator ${operator} for TAG`)
        return null
    }
  }

  private buildLabelCondition(condition: FilterCondition): SQL<unknown> | null {
    const { operator, value } = condition

    // Handle IS_EMPTY / IS_NOT_EMPTY first
    if (operator === ComparisonOperator.IS_EMPTY) {
      // No associated labels - use NOT EXISTS
      return not(
        exists(db.select().from(LabelsOnThread).where(eq(LabelsOnThread.threadId, Thread.id)))
      )
    }
    if (operator === ComparisonOperator.IS_NOT_EMPTY) {
      // At least one associated label - use EXISTS
      return exists(db.select().from(LabelsOnThread).where(eq(LabelsOnThread.threadId, Thread.id)))
    }

    // Validate value for other operators
    if (value === null || typeof value === 'undefined') {
      this.logger.warn(`Missing label value for operator ${operator}`, { condition })
      return null
    }

    const labelId = value as string
    const labelIds = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [labelId].filter((v): v is string => typeof v === 'string')

    if (labelIds.length === 0 && value !== null) {
      this.logger.warn('Invalid label ID(s) provided', { value })
      return null
    }

    switch (operator) {
      case ComparisonOperator.EQUALS: // "has this label"
        if (Array.isArray(value)) {
          this.logger.warn(`EQUALS operator used with array value for LABEL, interpreting as IN`, {
            value,
          })
          return exists(
            db
              .select()
              .from(schema.LabelsOnThread)
              .where(
                and(
                  eq(schema.LabelsOnThread.threadId, schema.Thread.id),
                  inArray(schema.LabelsOnThread.labelId, labelIds)
                )
              )
          )
        }
        return exists(
          db
            .select()
            .from(schema.LabelsOnThread)
            .where(
              and(
                eq(schema.LabelsOnThread.threadId, schema.Thread.id),
                eq(schema.LabelsOnThread.labelId, labelId)
              )
            )
        )
      case ComparisonOperator.NOT_EQUALS: // "does not have this label"
        if (Array.isArray(value)) {
          this.logger.warn(
            `NOT_EQUALS operator used with array value for LABEL, interpreting as NOT_IN`,
            { value }
          )
          return not(
            exists(
              db
                .select()
                .from(schema.LabelsOnThread)
                .where(
                  and(
                    eq(schema.LabelsOnThread.threadId, schema.Thread.id),
                    inArray(schema.LabelsOnThread.labelId, labelIds)
                  )
                )
            )
          )
        }
        return not(
          exists(
            db
              .select()
              .from(LabelsOnThread)
              .where(
                and(
                  eq(schema.LabelsOnThread.threadId, schema.Thread.id),
                  eq(schema.LabelsOnThread.labelId, labelId)
                )
              )
          )
        )
      case ComparisonOperator.IN:
        if (!Array.isArray(value)) {
          this.logger.warn(`IN operator requires an array value for LABEL`, { value })
          return exists(
            db
              .select()
              .from(schema.LabelsOnThread)
              .where(
                and(
                  eq(schema.LabelsOnThread.threadId, schema.Thread.id),
                  eq(schema.LabelsOnThread.labelId, labelId)
                )
              )
          ) // Fallback to single label check
        }
        return exists(
          db
            .select()
            .from(schema.LabelsOnThread)
            .where(
              and(
                eq(schema.LabelsOnThread.threadId, schema.Thread.id),
                inArray(schema.LabelsOnThread.labelId, labelIds)
              )
            )
        )
      case ComparisonOperator.NOT_IN:
        if (!Array.isArray(value)) {
          this.logger.warn(`NOT_IN operator requires an array value for LABEL`, { value })
          return not(
            exists(
              db
                .select()
                .from(schema.LabelsOnThread)
                .where(
                  and(
                    eq(schema.LabelsOnThread.threadId, schema.Thread.id),
                    eq(schema.LabelsOnThread.labelId, labelId)
                  )
                )
            )
          ) // Fallback to single label check
        }
        return not(
          exists(
            db
              .select()
              .from(schema.LabelsOnThread)
              .where(
                and(
                  eq(schema.LabelsOnThread.threadId, schema.Thread.id),
                  inArray(schema.LabelsOnThread.labelId, labelIds)
                )
              )
          )
        )
      default:
        this.logger.warn(`Unsupported operator ${operator} for LABEL`)
        return null
    }
  }

  private buildAssigneeCondition(condition: FilterCondition): SQL<unknown> | null {
    const { operator, value } = condition

    // Handle IS_EMPTY / IS_NOT_EMPTY first
    if (operator === ComparisonOperator.IS_EMPTY) {
      return isNull(Thread.assigneeId)
    }
    if (operator === ComparisonOperator.IS_NOT_EMPTY) {
      return isNotNull(Thread.assigneeId)
    }

    // Process value based on expected type for remaining operators
    let processedId: string | null = null
    let processedIds: string[] | null = null

    if (operator === ComparisonOperator.IN || operator === ComparisonOperator.NOT_IN) {
      if (!Array.isArray(value)) {
        this.logger.warn(`Assignee condition (${operator}) expected an array value`, { value })
        return null
      }
      processedIds = value
        .filter(
          (item): item is TeamMember =>
            item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
        )
        .map((item) => item.id)

      if (processedIds.length === 0 && value.length > 0) {
        this.logger.warn(
          `Assignee condition (${operator}) received array with invalid/missing IDs`,
          { value }
        )
        return inArray(schema.Thread.assigneeId, []) // Return condition that finds nothing
      }
    } else if (
      operator === ComparisonOperator.EQUALS ||
      operator === ComparisonOperator.NOT_EQUALS
    ) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'string'
      ) {
        processedId = value.id
      } else if (typeof value === 'string') {
        processedId = value // Allow raw ID string
      } else if (value === null) {
        processedId = null // Allow checking for null
      } else {
        // Value is required for these operators (unless it's null)
        this.logger.warn(`Assignee condition (${operator}) received unexpected or missing value`, {
          value,
        })
        return null
      }
    } else {
      // Other operators like CONTAINS are not valid for Assignee ID
      this.logger.warn(`Unsupported operator ${operator} for ASSIGNEE`)
      return null
    }

    // Apply the operator
    switch (operator) {
      case ComparisonOperator.EQUALS:
        return processedId === null ? isNull(Thread.assigneeId) : eq(Thread.assigneeId, processedId)
      case ComparisonOperator.NOT_EQUALS:
        return processedId === null
          ? isNotNull(Thread.assigneeId)
          : not(eq(Thread.assigneeId, processedId))
      case ComparisonOperator.IN:
        if (processedIds === null) {
          // Should not happen based on logic above
          this.logger.error(`Internal error: processedIds null for IN operator in ASSIGNEE`)
          return null
        }
        return inArray(Thread.assigneeId, processedIds)
      case ComparisonOperator.NOT_IN:
        if (processedIds === null) {
          // Should not happen based on logic above
          this.logger.error(`Internal error: processedIds null for NOT_IN operator in ASSIGNEE`)
          return null
        }
        return not(inArray(Thread.assigneeId, processedIds))
      default:
        // IS_EMPTY / IS_NOT_EMPTY handled earlier. CONTAINS etc. not valid.
        this.logger.warn(`Operator ${operator} already handled or invalid for ASSIGNEE`)
        return null // Should have been handled or rejected already
    }
  }

  private buildStatusCondition(condition: FilterCondition): SQL<unknown> | null {
    const { operator } = condition
    const value = condition.value as ThreadStatus

    const validStatuses = ThreadStatusValues

    // Handle IS_EMPTY / IS_NOT_EMPTY (assuming status is NOT nullable)
    if (operator === ComparisonOperator.IS_EMPTY || operator === ComparisonOperator.IS_NOT_EMPTY) {
      this.logger.warn(
        `IS_EMPTY/IS_NOT_EMPTY is not applicable for non-nullable STATUS enum. Ignoring condition.`
      )
      return eq(Thread.id, Thread.id) // Return condition that matches everything, effectively ignoring this condition
    }

    // Validate value for other operators
    if (value === null || typeof value === 'undefined') {
      this.logger.warn(`Missing status value for operator ${operator}`, { condition })
      return null
    }

    const statusValue = value as ThreadStatus
    const statusValues: ThreadStatus[] = Array.isArray(value) ? value : [statusValue]

    const cleanStatusValues: ThreadStatus[] = statusValues.filter((s) => validStatuses.includes(s))

    if (cleanStatusValues.length === 0 && value !== null) {
      // Ensure non-null value resulted in empty clean array
      this.logger.warn('Invalid status value(s) provided for STATUS condition', { value })
      return null // Or return a condition that finds nothing, e.g., { status: { in: [] } }
    }

    switch (operator) {
      case ComparisonOperator.EQUALS:
        if (!validStatuses.includes(statusValue)) {
          this.logger.warn('Invalid status value for EQUALS operator', { statusValue })
          return null
        }
        return eq(Thread.status, statusValue)
      case ComparisonOperator.NOT_EQUALS:
        if (!validStatuses.includes(statusValue)) {
          this.logger.warn('Invalid status value for NOT_EQUALS operator', { statusValue })
          return null
        }
        return not(eq(Thread.status, statusValue))
      case ComparisonOperator.IN:
        return inArray(Thread.status, cleanStatusValues) // Handles empty array correctly
      case ComparisonOperator.NOT_IN:
        return not(inArray(Thread.status, cleanStatusValues)) // Handles empty array correctly
      default:
        this.logger.warn(`Unsupported operator ${operator} for STATUS`)
        return null
    }
  }

  private buildDateCondition(condition: FilterCondition): SQL<unknown> | null {
    const { operator, value, field = 'lastMessageAt' } = condition // Default field
    const validDateFields: string[] = [
      // Check against Thread model fields
      'createdAt',
      'updatedAt',
      'firstMessageAt',
      'lastMessageAt',
      'closedAt',
    ]

    if (!validDateFields.includes(field)) {
      this.logger.warn(`Invalid or unsupported date field specified: ${field}`)
      return null
    }
    // Get the actual column reference from the Thread table
    let dateColumn: any
    switch (field) {
      case 'createdAt':
        dateColumn = Thread.createdAt
        break
      case 'updatedAt':
        dateColumn = Thread.createdAt // Note: Thread table doesn't have updatedAt, using createdAt
        break
      case 'firstMessageAt':
        dateColumn = Thread.firstMessageAt
        break
      case 'lastMessageAt':
        dateColumn = Thread.lastMessageAt
        break
      case 'closedAt':
        dateColumn = Thread.closedAt
        break
      default:
        this.logger.warn(`Unsupported date field: ${field}`)
        return null
    }

    // Handle IS_EMPTY / IS_NOT_EMPTY first (check if the date field can be null)
    if (operator === ComparisonOperator.IS_EMPTY) {
      return isNull(dateColumn)
    }
    if (operator === ComparisonOperator.IS_NOT_EMPTY) {
      return isNotNull(dateColumn)
    }

    // Ensure value is provided for other operators
    if (value === null || typeof value === 'undefined') {
      this.logger.warn(`Missing date value for operator ${operator}`)
      return null
    }

    // Parse the date value (ISO string or relative keyword)
    let dateRange: { gte: Date; lte: Date } | null = null
    try {
      const parsed = this.parseDateValue(value) // Should always return range or throw
      if (parsed && 'gte' in parsed && 'lte' in parsed) {
        dateRange = parsed
      } else {
        throw new Error('parseDateValue did not return expected range object')
      }
    } catch (e) {
      this.logger.error('Invalid date value provided for DATE condition', {
        value,
        field,
        error: (e as Error).message,
      })
      return null
    }

    if (!dateRange) {
      // Should be caught by try/catch, but as safeguard
      this.logger.error('Internal error: dateRange is null after parsing', { value })
      return null
    }

    switch (operator) {
      case ComparisonOperator.EQUALS: // "On this day/range"
        return and(
          gte(dateColumn, dateRange.gte.toISOString()),
          lte(dateColumn, dateRange.lte.toISOString())
        )!
      case ComparisonOperator.BEFORE: // Before the start of the date/range
        return lt(dateColumn, dateRange.gte.toISOString())
      case ComparisonOperator.AFTER: // After the end of the date/range
        return gt(dateColumn, dateRange.lte.toISOString())
      default:
        this.logger.warn(`Unsupported operator ${operator} for DATE`)
        return null
    }
  }

  /**
   * Parses a date value (ISO string or relative range string) into a UTC date range.
   * @param value The date value string.
   * @returns An object { gte: Date, lte: Date } representing the UTC range.
   * @throws Error if the value is invalid.
   */
  private parseDateValue(value: any): { gte: Date; lte: Date } {
    if (value instanceof Date) {
      // If a Date object is passed, convert it to a day range in UTC
      this.logger.warn(
        'Received Date object directly in parseDateValue, converting to UTC day range.'
      )
      const yearUTC = value.getUTCFullYear()
      const monthUTC = value.getUTCMonth()
      const dayUTC = value.getUTCDate()
      const startDate = new Date(Date.UTC(yearUTC, monthUTC, dayUTC))
      const endDate = new Date(Date.UTC(yearUTC, monthUTC, dayUTC, 23, 59, 59, 999))
      return { gte: startDate, lte: endDate }
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('Invalid or empty date value provided')
    }

    const now = new Date() // Use local time to determine "today" relative to user
    // But perform calculations in UTC
    const todayYearUTC = now.getUTCFullYear()
    const todayMonthUTC = now.getUTCMonth()
    const todayDateUTC = now.getUTCDate()

    // Start of today in UTC
    const todayStartUTC = new Date(Date.UTC(todayYearUTC, todayMonthUTC, todayDateUTC))

    let startDate: Date
    let endDate: Date

    switch (value.toLowerCase()) {
      case 'today':
        startDate = todayStartUTC
        endDate = new Date(Date.UTC(todayYearUTC, todayMonthUTC, todayDateUTC, 23, 59, 59, 999))
        break
      case 'yesterday': {
        const yesterdayStartUTC = new Date(todayStartUTC)
        yesterdayStartUTC.setUTCDate(todayStartUTC.getUTCDate() - 1)
        startDate = yesterdayStartUTC
        endDate = new Date(
          Date.UTC(
            yesterdayStartUTC.getUTCFullYear(),
            yesterdayStartUTC.getUTCMonth(),
            yesterdayStartUTC.getUTCDate(),
            23,
            59,
            59,
            999
          )
        )
        break
      }
      case 'last7days': {
        // Includes today? Or last 7 full days ending yesterday? Let's do last 7 full days + today so far.
        // Start of 7 days ago (including today as day 1)
        const start7DaysAgoUTC = new Date(todayStartUTC)
        start7DaysAgoUTC.setUTCDate(todayStartUTC.getUTCDate() - 6)
        startDate = start7DaysAgoUTC
        // End of today
        endDate = new Date(Date.UTC(todayYearUTC, todayMonthUTC, todayDateUTC, 23, 59, 59, 999))
        break
      }
      case 'last30days': {
        // Start of 30 days ago (including today as day 1)
        const start30DaysAgoUTC = new Date(todayStartUTC)
        start30DaysAgoUTC.setUTCDate(todayStartUTC.getUTCDate() - 29)
        startDate = start30DaysAgoUTC
        // End of today
        endDate = new Date(Date.UTC(todayYearUTC, todayMonthUTC, todayDateUTC, 23, 59, 59, 999))
        break
      }
      case 'thismonth':
        // Start of current month in UTC
        startDate = new Date(Date.UTC(todayYearUTC, todayMonthUTC, 1))
        // End of the last day of the current month in UTC
        endDate = new Date(Date.UTC(todayYearUTC, todayMonthUTC + 1, 0, 23, 59, 59, 999))
        break
      case 'lastmonth':
        // Start of last month in UTC
        startDate = new Date(Date.UTC(todayYearUTC, todayMonthUTC - 1, 1))
        // End of the last day of last month in UTC
        endDate = new Date(Date.UTC(todayYearUTC, todayMonthUTC, 0, 23, 59, 59, 999))
        break
      default: {
        // Attempt to parse as ISO string or other Date constructor compatible format
        const parsedDate = new Date(value)
        if (isNaN(parsedDate.getTime())) {
          throw new Error(`Invalid date string format: ${value}`)
        }
        // Convert parsed date to UTC day range
        const parsedYearUTC = parsedDate.getUTCFullYear()
        const parsedMonthUTC = parsedDate.getUTCMonth()
        const parsedDayUTC = parsedDate.getUTCDate()
        startDate = new Date(Date.UTC(parsedYearUTC, parsedMonthUTC, parsedDayUTC))
        endDate = new Date(Date.UTC(parsedYearUTC, parsedMonthUTC, parsedDayUTC, 23, 59, 59, 999))
        break
      }
    }

    // Should always have a valid range here or have thrown an error
    return { gte: startDate, lte: endDate }
  }

  /** Builds condition for SENDER filtering based on Message Participants */
  private buildSenderCondition(condition: FilterCondition): SQL<unknown> | null {
    const { operator, value } = condition

    // Interpret IS_EMPTY / IS_NOT_EMPTY relative to messages with a FROM participant
    if (operator === ComparisonOperator.IS_EMPTY) {
      // Find threads where NO message has a FROM participant (unlikely/edge case?)
      // Or interpret as "no messages at all"? Let's use the latter for simplicity.
      this.logger.warn(`Interpreting IS_EMPTY for SENDER as 'thread has no messages'`)
      return not(exists(db.select().from(Message).where(eq(Message.threadId, Thread.id))))
    }
    if (operator === ComparisonOperator.IS_NOT_EMPTY) {
      // Find threads where AT LEAST ONE message has a FROM participant
      return exists(
        db
          .select()
          .from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .where(and(eq(Message.threadId, Thread.id), eq(MessageParticipant.role, 'FROM')))
      )
    }

    // Ensure value is provided for other operators
    if (value === null || typeof value === 'undefined' || value === '') {
      this.logger.warn(`Missing sender value for operator ${operator}`)
      return null
    }

    const senderIdentifier = value as string
    const senderIdentifiers = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : [senderIdentifier].filter((v) => typeof v === 'string' && v.trim() !== '') // Ensure non-empty strings

    if (senderIdentifiers.length === 0) {
      this.logger.warn('Invalid or empty sender identifier(s) provided', { value })
      return null
    }

    // Build the participant identifier condition based on operator
    let participantCondition: SQL<unknown>
    switch (operator) {
      case ComparisonOperator.EQUALS:
        participantCondition = ilike(Participant.identifier, senderIdentifiers[0]) // Case-insensitive match
        break
      case ComparisonOperator.NOT_EQUALS:
        participantCondition = not(ilike(Participant.identifier, senderIdentifiers[0]))
        break
      case ComparisonOperator.CONTAINS:
        participantCondition = ilike(Participant.identifier, `%${senderIdentifiers[0]}%`)
        break
      case ComparisonOperator.NOT_CONTAINS:
        participantCondition = not(ilike(Participant.identifier, `%${senderIdentifiers[0]}%`))
        break
      case ComparisonOperator.IN:
        // For case-insensitive IN, we need to use OR with multiple ilike conditions
        participantCondition = or(
          ...senderIdentifiers.map((identifier) => ilike(Participant.identifier, identifier))
        )!
        break
      case ComparisonOperator.NOT_IN:
        // For case-insensitive NOT IN, we need to use AND with multiple NOT ilike conditions
        participantCondition = and(
          ...senderIdentifiers.map((identifier) => not(ilike(Participant.identifier, identifier)))
        )!
        break
      default:
        this.logger.warn(`Unsupported operator ${operator} for SENDER`)
        return null
    }

    // Apply the participant condition within the messages relationship
    // Use EXISTS with complex joins to find threads with messages from matching participants
    return exists(
      db
        .select()
        .from(Message)
        .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
        .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
        .where(
          and(
            eq(Message.threadId, Thread.id),
            eq(MessageParticipant.role, 'FROM'),
            participantCondition
          )
        )
    )
  }

  private buildSubjectCondition(condition: FilterCondition): SQL<unknown> | null {
    const { operator, value } = condition

    // Handle IS_EMPTY / IS_NOT_EMPTY first
    if (operator === ComparisonOperator.IS_EMPTY) {
      return or(isNull(Thread.subject), eq(Thread.subject, ''))! // Check for null or empty string
    }
    if (operator === ComparisonOperator.IS_NOT_EMPTY) {
      // Check not null AND not empty string
      return and(isNotNull(Thread.subject), not(eq(Thread.subject, '')))!
    }

    // Ensure value is a string for other operators (allow empty string for EQUALS/NOT_EQUALS)
    if (typeof value !== 'string') {
      if (value === null || typeof value === 'undefined') {
        this.logger.warn(`Missing subject value for operator ${operator}`)
        return null
      }
      this.logger.warn(`Subject value must be a string for operator ${operator}`)
      return null // Reject non-string values (like numbers)
    }
    // CONTAINS/NOT_CONTAINS should arguably require non-empty string
    if (
      (operator === ComparisonOperator.CONTAINS || operator === ComparisonOperator.NOT_CONTAINS) &&
      value.trim() === ''
    ) {
      this.logger.warn(`Empty subject value is not meaningful for operator ${operator}`)
      return null // Or return {} if it should be ignored? Null seems safer.
    }

    const subjectValue = value as string

    switch (operator) {
      case ComparisonOperator.EQUALS:
        return ilike(Thread.subject, subjectValue)
      case ComparisonOperator.NOT_EQUALS:
        return not(ilike(Thread.subject, subjectValue))
      case ComparisonOperator.CONTAINS:
        return ilike(Thread.subject, `%${subjectValue}%`)
      case ComparisonOperator.NOT_CONTAINS:
        return not(ilike(Thread.subject, `%${subjectValue}%`))
      default:
        this.logger.warn(`Unsupported operator ${operator} for SUBJECT`)
        return null
    }
  }

  private buildInboxCondition(condition: FilterCondition): SQL<unknown> | null {
    const { operator, value } = condition

    // Note: Thread.inboxId was removed in migration 0028
    // Filter by inbox through InboxIntegration join

    // Handle IS_EMPTY / IS_NOT_EMPTY first
    if (operator === ComparisonOperator.IS_EMPTY) {
      // Thread has no inbox (no InboxIntegration entry for this integration)
      return not(
        exists(
          db
            .select()
            .from(schema.InboxIntegration)
            .where(eq(schema.InboxIntegration.integrationId, Thread.integrationId))
        )
      )
    }
    if (operator === ComparisonOperator.IS_NOT_EMPTY) {
      // Thread has an inbox (has InboxIntegration entry for this integration)
      return exists(
        db
          .select()
          .from(schema.InboxIntegration)
          .where(eq(schema.InboxIntegration.integrationId, Thread.integrationId))
      )
    }

    // Ensure value is provided for other operators
    if (value === null || typeof value === 'undefined') {
      this.logger.warn(`Missing inbox value for operator ${operator}`)
      return null
    }

    const inboxId = value as string
    const inboxIds = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [inboxId].filter((v): v is string => typeof v === 'string') // Ensure strings

    if (inboxIds.length === 0 && value !== null) {
      this.logger.warn('Invalid inbox ID(s) provided', { value })
      return null
    }

    switch (operator) {
      case ComparisonOperator.EQUALS:
        if (Array.isArray(value)) {
          this.logger.warn(`EQUALS operator used with array value for INBOX, interpreting as IN`, {
            value,
          })
          return exists(
            db
              .select()
              .from(schema.InboxIntegration)
              .where(
                and(
                  eq(schema.InboxIntegration.integrationId, Thread.integrationId),
                  inArray(schema.InboxIntegration.inboxId, inboxIds)
                )
              )
          )
        }
        return exists(
          db
            .select()
            .from(schema.InboxIntegration)
            .where(
              and(
                eq(schema.InboxIntegration.integrationId, Thread.integrationId),
                eq(schema.InboxIntegration.inboxId, inboxId)
              )
            )
        )
      case ComparisonOperator.NOT_EQUALS:
        if (Array.isArray(value)) {
          this.logger.warn(
            `NOT_EQUALS operator used with array value for INBOX, interpreting as NOT_IN`,
            { value }
          )
          return not(
            exists(
              db
                .select()
                .from(schema.InboxIntegration)
                .where(
                  and(
                    eq(schema.InboxIntegration.integrationId, Thread.integrationId),
                    inArray(schema.InboxIntegration.inboxId, inboxIds)
                  )
                )
            )
          )
        }
        return not(
          exists(
            db
              .select()
              .from(schema.InboxIntegration)
              .where(
                and(
                  eq(schema.InboxIntegration.integrationId, Thread.integrationId),
                  eq(schema.InboxIntegration.inboxId, inboxId)
                )
              )
          )
        )
      case ComparisonOperator.IN:
        if (!Array.isArray(value)) {
          this.logger.warn(`IN operator requires an array value for INBOX`, { value })
          return exists(
            db
              .select()
              .from(schema.InboxIntegration)
              .where(
                and(
                  eq(schema.InboxIntegration.integrationId, Thread.integrationId),
                  eq(schema.InboxIntegration.inboxId, inboxId)
                )
              )
          )
        }
        return exists(
          db
            .select()
            .from(schema.InboxIntegration)
            .where(
              and(
                eq(schema.InboxIntegration.integrationId, Thread.integrationId),
                inArray(schema.InboxIntegration.inboxId, inboxIds)
              )
            )
        )
      case ComparisonOperator.NOT_IN:
        if (!Array.isArray(value)) {
          this.logger.warn(`NOT_IN operator requires an array value for INBOX`, { value })
          return not(
            exists(
              db
                .select()
                .from(schema.InboxIntegration)
                .where(
                  and(
                    eq(schema.InboxIntegration.integrationId, Thread.integrationId),
                    eq(schema.InboxIntegration.inboxId, inboxId)
                  )
                )
            )
          )
        }
        return not(
          exists(
            db
              .select()
              .from(schema.InboxIntegration)
              .where(
                and(
                  eq(schema.InboxIntegration.integrationId, Thread.integrationId),
                  inArray(schema.InboxIntegration.inboxId, inboxIds)
                )
              )
          )
        )
      default:
        this.logger.warn(`Unsupported operator ${operator} for INBOX`)
        return null
    }
  }
} // End of MailViewQueryBuilder class
