// packages/lib/src/mail-query/condition-query-builder.ts

import { database as db, schema } from '@auxx/database'

const { Thread } = schema

import { type ActorId, getActorRawId, isActorId } from '@auxx/types/actor'
import { getInstanceId, isRecordId, type RecordId } from '@auxx/types/resource'
import {
  and,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { Operator } from '../conditions/operator-definitions'
import type { Condition, ConditionGroup } from '../conditions/types'
import {
  threadDoesNotHaveTags,
  threadHasAnyTags,
  threadHasNoTags,
  threadHasTags,
} from '../field-values/relationship-queries'
import { createScopedLogger } from '../logger'

const logger = createScopedLogger('condition-query-builder')

/**
 * Build Drizzle WHERE condition from ConditionGroup[].
 * Groups are combined with AND at the top level.
 */
export function buildConditionGroupsQuery(
  groups: ConditionGroup[],
  organizationId: string
): SQL<unknown> {
  if (groups.length === 0) {
    // No conditions -> match all (within org)
    return eq(Thread.organizationId, organizationId)
  }

  const groupConditions = groups.map((group) => buildGroupQuery(group, organizationId))
  const validConditions = groupConditions.filter(Boolean) as SQL<unknown>[]

  if (validConditions.length === 0) {
    return eq(Thread.organizationId, organizationId)
  }

  // Groups combined with AND
  return and(eq(Thread.organizationId, organizationId), ...validConditions)!
}

/**
 * Build query for a single ConditionGroup.
 */
function buildGroupQuery(group: ConditionGroup, organizationId: string): SQL<unknown> | null {
  const conditions = group.conditions
    .map((c) => buildConditionQuery(c, organizationId))
    .filter(Boolean) as SQL<unknown>[]

  if (conditions.length === 0) return null
  if (conditions.length === 1) return conditions[0]

  return group.logicalOperator === 'AND' ? and(...conditions)! : or(...conditions)!
}

/**
 * Build query for a single Condition.
 */
function buildConditionQuery(condition: Condition, organizationId: string): SQL<unknown> | null {
  // Belt-and-suspenders: valueSource must be resolved upstream via
  // resolveConditionContext before reaching this builder.
  if (condition.valueSource) {
    logger.warn(
      `Dropping condition with unresolved valueSource '${condition.valueSource}' (${condition.fieldId}) — should be substituted upstream`
    )
    return null
  }

  const { fieldId, operator, value, metadata } = condition
  const op = operator as Operator

  try {
    switch (fieldId) {
      case 'tag':
        return buildTagQuery(op, value, organizationId)
      case 'assignee':
        return buildAssigneeQuery(op, value)
      case 'inbox':
        return buildInboxQuery(op, value)
      case 'status':
        return buildStatusQuery(op, value)
      case 'date':
        return buildDateQuery(op, value, metadata?.field)
      case 'sender':
        return buildSenderQuery(op, value)
      case 'from':
        return buildFromQuery(op, value)
      case 'to':
        return buildToQuery(op, value)
      case 'subject':
        return buildSubjectQuery(op, value)
      case 'body':
        return buildBodyQuery(op, value)
      case 'before':
        return buildBeforeQuery(op, value)
      case 'after':
        return buildAfterQuery(op, value)
      case 'ticket':
        return buildTicketQuery(op, value)
      case 'hasAttachments':
        return buildHasAttachmentsQuery(op, value)
      case 'freeText':
        return buildFreeTextQuery(op, value)
      case 'hasDraft':
        return buildHasDraftQuery(op, value)
      case 'sent':
        return buildSentQuery(op, value)
      // Direct-column fields (needed by find node)
      case 'id':
        return buildDirectColumnQuery(op, value, Thread.id)
      case 'externalId':
        return buildDirectColumnQuery(op, value, Thread.externalId)
      case 'messageCount':
        return buildDirectNumberColumnQuery(op, value, Thread.messageCount)
      case 'firstMessageAt':
        return buildDateQuery(op, value, 'firstMessageAt')
      case 'closedAt':
        return buildDateQuery(op, value, 'closedAt')
      case 'createdAt':
        return buildDateQuery(op, value, 'createdAt')
      case 'lastMessageAt':
        return buildDateQuery(op, value, 'lastMessageAt')
      default:
        logger.warn(`Unknown fieldId: ${fieldId}`)
        return null
    }
  } catch (error: any) {
    logger.error(`Error building condition for ${fieldId}`, { error: error.message })
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FIELD-SPECIFIC QUERY BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build tag condition query using FieldValue relationship.
 * Tags are stored in FieldValue table with systemAttribute='thread_tags'.
 */
function buildTagQuery(
  operator: Operator,
  value: any,
  organizationId: string
): SQL<unknown> | null {
  switch (operator) {
    case 'empty':
      return threadHasNoTags(db, Thread.id, organizationId)
    case 'not empty':
      return threadHasAnyTags(db, Thread.id, organizationId)
    case 'in':
    case 'is': {
      const raw = Array.isArray(value) ? value : [value]
      // Strip RecordId prefix if present (e.g., "tag:abc123" → "abc123")
      const tagIds: string[] = raw.map((v: string) =>
        isRecordId(v) ? getInstanceId(v as RecordId) : v
      )
      if (tagIds.length === 0) return null
      return threadHasTags(db, Thread.id, tagIds, organizationId)
    }
    case 'not in':
    case 'is not': {
      const rawExclude = Array.isArray(value) ? value : [value]
      const excludeTagIds: string[] = rawExclude.map((v: string) =>
        isRecordId(v) ? getInstanceId(v as RecordId) : v
      )
      if (excludeTagIds.length === 0) return null
      return threadDoesNotHaveTags(db, Thread.id, excludeTagIds, organizationId)
    }
    default:
      return null
  }
}

/**
 * Build assignee condition query.
 * Handles TeamMember objects or string IDs.
 */
function buildAssigneeQuery(operator: Operator, value: any): SQL<unknown> | null {
  const extractIds = (v: any): string[] => {
    if (!v) return []
    const items = Array.isArray(v) ? v : [v]
    return items
      .map((item) => {
        if (typeof item === 'object' && item !== null) return item.id
        // Strip ActorId prefix (e.g., "user:abc123" → "abc123")
        if (isActorId(item)) return getActorRawId(item as ActorId)
        return item
      })
      .filter(Boolean)
  }

  switch (operator) {
    case 'empty':
      return isNull(Thread.assigneeId)
    case 'not empty':
      return isNotNull(Thread.assigneeId)
    case 'is': {
      const singleId = extractIds(value)[0]
      return singleId ? eq(Thread.assigneeId, singleId) : null
    }
    case 'is not': {
      const excludeId = extractIds(value)[0]
      return excludeId ? not(eq(Thread.assigneeId, excludeId)) : null
    }
    case 'in': {
      const ids = extractIds(value)
      return ids.length ? inArray(Thread.assigneeId, ids) : null
    }
    case 'not in': {
      const excludeIds = extractIds(value)
      return excludeIds.length ? not(inArray(Thread.assigneeId, excludeIds)) : null
    }
    default:
      return null
  }
}

/**
 * Build inbox condition query.
 * Uses the direct Thread.inboxId column (denormalized from InboxIntegration).
 */
function buildInboxQuery(operator: Operator, value: any): SQL<unknown> | null {
  const raw = Array.isArray(value) ? value : [value]
  // Strip RecordId prefix if present (e.g., "inbox:abc123" → "abc123")
  const inboxIds: string[] = raw.map((v: string) =>
    isRecordId(v) ? getInstanceId(v as RecordId) : v
  )

  switch (operator) {
    case 'empty':
      return isNull(Thread.inboxId)
    case 'not empty':
      return isNotNull(Thread.inboxId)
    case 'is':
      if (inboxIds.length === 0) return null
      if (inboxIds.length === 1) return eq(Thread.inboxId, inboxIds[0])
      return inArray(Thread.inboxId, inboxIds)
    case 'in':
      if (inboxIds.length === 0) return null
      return inArray(Thread.inboxId, inboxIds)
    case 'is not':
      if (inboxIds.length === 0) return null
      if (inboxIds.length === 1) return not(eq(Thread.inboxId, inboxIds[0]))
      return not(inArray(Thread.inboxId, inboxIds))
    case 'not in':
      if (inboxIds.length === 0) return null
      return not(inArray(Thread.inboxId, inboxIds))
    default:
      return null
  }
}

/**
 * Build ticket condition query.
 * Filters threads whose primary EntityInstance points at the given ticket.
 * Now backed by `Thread.primaryEntityInstanceId` (the legacy `ticketId` column
 * was renamed in Phase 1 of the multi-entity linking refactor).
 */
function buildTicketQuery(operator: Operator, value: any): SQL<unknown> | null {
  const ticketId = isRecordId(value) ? getInstanceId(value as RecordId) : value

  switch (operator) {
    case 'is':
      return eq(Thread.primaryEntityInstanceId, ticketId)
    case 'is not':
      return not(eq(Thread.primaryEntityInstanceId, ticketId))
    case 'empty':
      return isNull(Thread.primaryEntityInstanceId)
    case 'not empty':
      return isNotNull(Thread.primaryEntityInstanceId)
    default:
      return null
  }
}

/**
 * Build status condition query.
 * Maps user-facing status values to database conditions.
 */
function buildStatusQuery(operator: Operator, value: any): SQL<unknown> | null {
  // Map user-facing status values to database conditions
  const getStatusCondition = (statusValue: string): SQL<unknown> | null => {
    switch (statusValue.toLowerCase()) {
      case 'open':
        return eq(Thread.status, 'OPEN')
      case 'unassigned':
        return and(isNull(Thread.assigneeId), eq(Thread.status, 'OPEN'))!
      case 'assigned':
        return and(isNotNull(Thread.assigneeId), eq(Thread.status, 'OPEN'))!
      case 'done':
      case 'archived':
        return eq(Thread.status, 'ARCHIVED')
      case 'trash':
        return eq(Thread.status, 'TRASH')
      case 'spam':
        return eq(Thread.status, 'SPAM')
      case 'ignored':
        return eq(Thread.status, 'IGNORED')
      default:
        return null
    }
  }

  // Handle 'not in' operator with array of status values (e.g., ['TRASH', 'SPAM'])
  if (operator === 'not in' && Array.isArray(value)) {
    const conditions = value.map((v) => getStatusCondition(v)).filter(Boolean) as SQL<unknown>[]
    if (conditions.length === 0) return null
    // NOT (status = TRASH OR status = SPAM) => status NOT IN (TRASH, SPAM)
    return not(or(...conditions)!)
  }

  // Handle 'in' operator with array of status values
  if (operator === 'in' && Array.isArray(value)) {
    const conditions = value.map((v) => getStatusCondition(v)).filter(Boolean) as SQL<unknown>[]
    if (conditions.length === 0) return null
    return or(...conditions)
  }

  const condition = getStatusCondition(value)
  if (!condition) return null

  switch (operator) {
    case 'is':
      return condition
    case 'is not':
      return not(condition)
    default:
      return null
  }
}

/**
 * Build date condition query.
 */
function buildDateQuery(operator: Operator, value: any, field?: string): SQL<unknown> | null {
  const dateColumn = getDateColumn(field || 'lastMessageAt')
  if (!dateColumn) return null

  const parseDate = (v: any): Date | null => {
    if (!v) return null
    if (v instanceof Date) return v
    const parsed = new Date(v)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  switch (operator) {
    case 'before': {
      const beforeDate = parseDate(value)
      return beforeDate ? lt(dateColumn, beforeDate) : null
    }
    case 'after': {
      const afterDate = parseDate(value)
      return afterDate ? gt(dateColumn, afterDate) : null
    }
    case 'is':
    case 'on_date': {
      const isDate = parseDate(value)
      if (!isDate) return null
      const startOfDay = new Date(isDate)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(isDate)
      endOfDay.setHours(23, 59, 59, 999)
      return and(gte(dateColumn, startOfDay), lte(dateColumn, endOfDay))
    }
    case 'is not':
    case 'not_on_date': {
      const isNotDate = parseDate(value)
      if (!isNotDate) return null
      const startOfDay = new Date(isNotDate)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(isNotDate)
      endOfDay.setHours(23, 59, 59, 999)
      return or(lt(dateColumn, startOfDay), gt(dateColumn, endOfDay))
    }
    case 'empty':
      return isNull(dateColumn)
    case 'not empty':
      return isNotNull(dateColumn)
    default:
      return null
  }
}

/**
 * Get date column from Thread table by field name.
 */
function getDateColumn(field: string) {
  const columnMap: Record<string, any> = {
    lastMessageAt: Thread.lastMessageAt,
    firstMessageAt: Thread.firstMessageAt,
    createdAt: Thread.createdAt,
    updatedAt: Thread.createdAt, // Thread doesn't have updatedAt, fallback to createdAt
    closedAt: Thread.closedAt,
  }
  return columnMap[field]
}

/**
 * Build sender condition query.
 * Filters through Message and MessageParticipant joins.
 */
function buildSenderQuery(operator: Operator, value: any): SQL<unknown> | null {
  const { Message, MessageParticipant, Participant } = schema

  switch (operator) {
    case 'empty':
      return not(
        exists(
          db
            .select({ id: sql`1` })
            .from(Message)
            .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
            .where(and(eq(Message.threadId, Thread.id), eq(MessageParticipant.role, 'FROM')))
        )
      )
    case 'not empty':
      return exists(
        db
          .select({ id: sql`1` })
          .from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .where(and(eq(Message.threadId, Thread.id), eq(MessageParticipant.role, 'FROM')))
      )
    case 'is': {
      const emails = Array.isArray(value) ? value : [value]
      if (emails.length === 0) return null
      const identifierMatch =
        emails.length === 1
          ? ilike(Participant.identifier, emails[0])
          : or(...emails.map((e: string) => ilike(Participant.identifier, e)))!
      return exists(
        db
          .select({ id: sql`1` })
          .from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
          .where(
            and(
              eq(Message.threadId, Thread.id),
              eq(MessageParticipant.role, 'FROM'),
              identifierMatch
            )
          )
      )
    }
    case 'is not': {
      const excludeEmails = Array.isArray(value) ? value : [value]
      if (excludeEmails.length === 0) return null
      const excludeMatch =
        excludeEmails.length === 1
          ? ilike(Participant.identifier, excludeEmails[0])
          : or(...excludeEmails.map((e: string) => ilike(Participant.identifier, e)))!
      return not(
        exists(
          db
            .select({ id: sql`1` })
            .from(Message)
            .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
            .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
            .where(
              and(
                eq(Message.threadId, Thread.id),
                eq(MessageParticipant.role, 'FROM'),
                excludeMatch
              )
            )
        )
      )
    }
    case 'contains':
      return exists(
        db
          .select({ id: sql`1` })
          .from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
          .where(
            and(
              eq(Message.threadId, Thread.id),
              eq(MessageParticipant.role, 'FROM'),
              ilike(Participant.identifier, `%${value}%`)
            )
          )
      )
    case 'not contains':
      return not(
        exists(
          db
            .select({ id: sql`1` })
            .from(Message)
            .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
            .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
            .where(
              and(
                eq(Message.threadId, Thread.id),
                eq(MessageParticipant.role, 'FROM'),
                ilike(Participant.identifier, `%${value}%`)
              )
            )
        )
      )
    default:
      return null
  }
}

/**
 * Build subject condition query.
 */
function buildSubjectQuery(operator: Operator, value: any): SQL<unknown> | null {
  switch (operator) {
    case 'is':
      return ilike(Thread.subject, value)
    case 'is not':
      return not(ilike(Thread.subject, value))
    case 'contains':
      return ilike(Thread.subject, `%${value}%`)
    case 'not contains':
      return not(ilike(Thread.subject, `%${value}%`))
    case 'empty':
      return or(isNull(Thread.subject), eq(Thread.subject, ''))
    case 'not empty':
      return and(isNotNull(Thread.subject), not(eq(Thread.subject, '')))
    default:
      return null
  }
}

/**
 * Build from (sender) condition query.
 * Filters through Message and MessageParticipant joins with role='FROM'.
 */
function buildFromQuery(operator: Operator, value: any): SQL<unknown> | null {
  // Reuse sender query logic as they're functionally the same
  return buildSenderQuery(operator, value)
}

/**
 * Build to (recipient) condition query.
 * Filters through Message and MessageParticipant joins with role='TO', 'CC', or 'BCC'.
 */
function buildToQuery(operator: Operator, value: any): SQL<unknown> | null {
  const { Message, MessageParticipant, Participant } = schema

  switch (operator) {
    case 'empty':
      return not(
        exists(
          db
            .select({ id: sql`1` })
            .from(Message)
            .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
            .where(
              and(
                eq(Message.threadId, Thread.id),
                inArray(MessageParticipant.role, ['TO', 'CC', 'BCC'])
              )
            )
        )
      )
    case 'not empty':
      return exists(
        db
          .select({ id: sql`1` })
          .from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .where(
            and(
              eq(Message.threadId, Thread.id),
              inArray(MessageParticipant.role, ['TO', 'CC', 'BCC'])
            )
          )
      )
    case 'is': {
      const emails = Array.isArray(value) ? value : [value]
      if (emails.length === 0) return null
      const identifierMatch =
        emails.length === 1
          ? ilike(Participant.identifier, emails[0])
          : or(...emails.map((e: string) => ilike(Participant.identifier, e)))!
      return exists(
        db
          .select({ id: sql`1` })
          .from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
          .where(
            and(
              eq(Message.threadId, Thread.id),
              inArray(MessageParticipant.role, ['TO', 'CC', 'BCC']),
              identifierMatch
            )
          )
      )
    }
    case 'is not': {
      const excludeEmails = Array.isArray(value) ? value : [value]
      if (excludeEmails.length === 0) return null
      const excludeMatch =
        excludeEmails.length === 1
          ? ilike(Participant.identifier, excludeEmails[0])
          : or(...excludeEmails.map((e: string) => ilike(Participant.identifier, e)))!
      return not(
        exists(
          db
            .select({ id: sql`1` })
            .from(Message)
            .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
            .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
            .where(
              and(
                eq(Message.threadId, Thread.id),
                inArray(MessageParticipant.role, ['TO', 'CC', 'BCC']),
                excludeMatch
              )
            )
        )
      )
    }
    case 'contains':
      return exists(
        db
          .select({ id: sql`1` })
          .from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
          .where(
            and(
              eq(Message.threadId, Thread.id),
              inArray(MessageParticipant.role, ['TO', 'CC', 'BCC']),
              ilike(Participant.identifier, `%${value}%`)
            )
          )
      )
    case 'not contains':
      return not(
        exists(
          db
            .select({ id: sql`1` })
            .from(Message)
            .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
            .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
            .where(
              and(
                eq(Message.threadId, Thread.id),
                inArray(MessageParticipant.role, ['TO', 'CC', 'BCC']),
                ilike(Participant.identifier, `%${value}%`)
              )
            )
        )
      )
    default:
      return null
  }
}

/**
 * Build body condition query.
 * Searches through Message bodyText field.
 */
function buildBodyQuery(operator: Operator, value: any): SQL<unknown> | null {
  const { Message } = schema

  const searchTerm = `%${value}%`
  const bodyMatch = or(ilike(Message.textPlain, searchTerm), ilike(Message.textHtml, searchTerm))

  switch (operator) {
    case 'contains':
      return exists(
        db
          .select({ id: sql`1` })
          .from(Message)
          .where(and(eq(Message.threadId, Thread.id), bodyMatch))
      )
    case 'not contains':
      return not(
        exists(
          db
            .select({ id: sql`1` })
            .from(Message)
            .where(and(eq(Message.threadId, Thread.id), bodyMatch))
        )
      )
    default:
      return null
  }
}

/**
 * Build before date condition query.
 * Filters threads with lastMessageAt before the given date.
 */
function buildBeforeQuery(operator: Operator, value: any): SQL<unknown> | null {
  return buildDateQuery('before', value, 'lastMessageAt')
}

/**
 * Build after date condition query.
 * Filters threads with lastMessageAt after the given date.
 */
function buildAfterQuery(operator: Operator, value: any): SQL<unknown> | null {
  return buildDateQuery('after', value, 'lastMessageAt')
}

/**
 * Build hasAttachments condition query.
 * Filters threads that have at least one message with attachments.
 */
function buildHasAttachmentsQuery(operator: Operator, value: any): SQL<unknown> | null {
  const { Message } = schema
  const hasAttachments = value === true || value === 'true'

  const subquery = db
    .select({ id: sql`1` })
    .from(Message)
    .where(and(eq(Message.threadId, Thread.id), eq(Message.hasAttachments, true)))

  return hasAttachments ? exists(subquery) : not(exists(subquery))
}

/**
 * Build free text search query.
 * Searches across subject and body fields.
 */
function buildFreeTextQuery(operator: Operator, value: any): SQL<unknown> | null {
  if (!value) return null

  const { Message } = schema
  const searchTerm = `%${value}%`

  // Search in subject OR body (textPlain / textHtml)
  return or(
    ilike(Thread.subject, searchTerm),
    exists(
      db
        .select({ id: sql`1` })
        .from(Message)
        .where(
          and(
            eq(Message.threadId, Thread.id),
            or(ilike(Message.textPlain, searchTerm), ilike(Message.textHtml, searchTerm))
          )
        )
    )
  )
}

/**
 * Build hasDraft condition query.
 * Filters threads that have at least one draft message.
 */
function buildHasDraftQuery(operator: Operator, value: any): SQL<unknown> | null {
  const { Draft } = schema
  const hasDraft = value === true || value === 'true'

  if (hasDraft) {
    return exists(db.select({ id: sql`1` }).from(Draft).where(eq(Draft.threadId, Thread.id)))
  } else {
    return not(exists(db.select({ id: sql`1` }).from(Draft).where(eq(Draft.threadId, Thread.id))))
  }
}

/**
 * Build sent condition query.
 * Filters threads where at least one message was sent by an internal user (outbound).
 */
function buildSentQuery(operator: Operator, value: any): SQL<unknown> | null {
  const { Message } = schema
  const isSent = value === true || value === 'true'

  // Sent messages are outbound (isInbound = false)
  if (isSent) {
    return exists(
      db
        .select({ id: sql`1` })
        .from(Message)
        .where(and(eq(Message.threadId, Thread.id), eq(Message.isInbound, false)))
    )
  } else {
    return not(
      exists(
        db
          .select({ id: sql`1` })
          .from(Message)
          .where(and(eq(Message.threadId, Thread.id), eq(Message.isInbound, false)))
      )
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DIRECT COLUMN BUILDERS (for find node — simple single-column filters)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build condition for a direct string/ID column on Thread.
 * Supports: is, is not, contains, not contains, starts with, ends with,
 * in, not in, empty, not empty, exists, not exists
 */
function buildDirectColumnQuery(
  operator: Operator,
  value: any,
  column: typeof Thread.id
): SQL<unknown> | null {
  switch (operator) {
    case 'is':
      if (value === null || value === undefined) return isNull(column)
      return eq(column, String(value))
    case 'is not':
      if (value === null || value === undefined) return isNotNull(column)
      return not(eq(column, String(value)))
    case 'contains':
      return ilike(column, `%${value}%`)
    case 'not contains':
      return not(ilike(column, `%${value}%`))
    case 'starts with':
      return ilike(column, `${value}%`)
    case 'ends with':
      return ilike(column, `%${value}`)
    case 'in': {
      const values = Array.isArray(value) ? value.map(String) : [String(value)]
      return values.length > 0 ? inArray(column, values) : null
    }
    case 'not in': {
      const values = Array.isArray(value) ? value.map(String) : [String(value)]
      return values.length > 0 ? not(inArray(column, values)) : null
    }
    case 'empty':
    case 'not exists':
      return or(isNull(column), eq(column, ''))
    case 'not empty':
    case 'exists':
      return and(isNotNull(column), not(eq(column, '')))
    default:
      return null
  }
}

/**
 * Build condition for a direct numeric column on Thread.
 * Supports: is, is not, >, <, >=, <=, empty, not empty
 */
function buildDirectNumberColumnQuery(
  operator: Operator,
  value: any,
  column: typeof Thread.messageCount
): SQL<unknown> | null {
  const numValue = value !== null && value !== undefined ? Number(value) : null

  switch (operator) {
    case 'is':
      if (numValue === null || Number.isNaN(numValue)) return isNull(column)
      return eq(column, numValue)
    case 'is not':
      if (numValue === null || Number.isNaN(numValue)) return isNotNull(column)
      return not(eq(column, numValue))
    case '>':
      return numValue !== null && !Number.isNaN(numValue) ? gt(column, numValue) : null
    case '<':
      return numValue !== null && !Number.isNaN(numValue) ? lt(column, numValue) : null
    case '>=':
      return numValue !== null && !Number.isNaN(numValue) ? gte(column, numValue) : null
    case '<=':
      return numValue !== null && !Number.isNaN(numValue) ? lte(column, numValue) : null
    case 'empty':
      return isNull(column)
    case 'not empty':
      return isNotNull(column)
    default:
      return null
  }
}
