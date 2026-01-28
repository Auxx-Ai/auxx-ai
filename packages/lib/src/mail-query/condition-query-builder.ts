// packages/lib/src/mail-query/condition-query-builder.ts

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
  sql,
  type SQL,
} from 'drizzle-orm'
import { Thread } from '@auxx/database/models'
import { database as db, schema } from '@auxx/database'
import type { Condition, ConditionGroup } from '../conditions/types'
import type { Operator } from '../conditions/operator-definitions'
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

  const groupConditions = groups.map(group => buildGroupQuery(group))
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
function buildGroupQuery(group: ConditionGroup): SQL<unknown> | null {
  const conditions = group.conditions.map(buildConditionQuery).filter(Boolean) as SQL<unknown>[]

  if (conditions.length === 0) return null
  if (conditions.length === 1) return conditions[0]

  return group.logicalOperator === 'AND' ? and(...conditions)! : or(...conditions)!
}

/**
 * Build query for a single Condition.
 */
function buildConditionQuery(condition: Condition): SQL<unknown> | null {
  const { fieldId, operator, value, metadata } = condition
  const op = operator as Operator

  try {
    switch (fieldId) {
      case 'tag':
        return buildTagQuery(op, value)
      case 'label':
        return buildLabelQuery(op, value)
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
      case 'subject':
        return buildSubjectQuery(op, value)
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
 * Build tag condition query.
 */
function buildTagQuery(operator: Operator, value: any): SQL<unknown> | null {
  switch (operator) {
    case 'empty':
      return not(exists(
        db.select({ id: sql`1` }).from(schema.TagsOnThread)
          .where(eq(schema.TagsOnThread.threadId, Thread.id))
      ))
    case 'not empty':
      return exists(
        db.select({ id: sql`1` }).from(schema.TagsOnThread)
          .where(eq(schema.TagsOnThread.threadId, Thread.id))
      )
    case 'in':
    case 'is':
      const tagIds = Array.isArray(value) ? value : [value]
      if (tagIds.length === 0) return null
      return exists(
        db.select({ id: sql`1` }).from(schema.TagsOnThread)
          .where(and(
            eq(schema.TagsOnThread.threadId, Thread.id),
            inArray(schema.TagsOnThread.tagId, tagIds)
          ))
      )
    case 'not in':
    case 'is not':
      const excludeTagIds = Array.isArray(value) ? value : [value]
      if (excludeTagIds.length === 0) return null
      return not(exists(
        db.select({ id: sql`1` }).from(schema.TagsOnThread)
          .where(and(
            eq(schema.TagsOnThread.threadId, Thread.id),
            inArray(schema.TagsOnThread.tagId, excludeTagIds)
          ))
      ))
    default:
      return null
  }
}

/**
 * Build label condition query.
 */
function buildLabelQuery(operator: Operator, value: any): SQL<unknown> | null {
  switch (operator) {
    case 'empty':
      return not(exists(
        db.select({ id: sql`1` }).from(schema.LabelsOnThread)
          .where(eq(schema.LabelsOnThread.threadId, Thread.id))
      ))
    case 'not empty':
      return exists(
        db.select({ id: sql`1` }).from(schema.LabelsOnThread)
          .where(eq(schema.LabelsOnThread.threadId, Thread.id))
      )
    case 'in':
    case 'is':
      const labelIds = Array.isArray(value) ? value : [value]
      if (labelIds.length === 0) return null
      return exists(
        db.select({ id: sql`1` }).from(schema.LabelsOnThread)
          .where(and(
            eq(schema.LabelsOnThread.threadId, Thread.id),
            inArray(schema.LabelsOnThread.labelId, labelIds)
          ))
      )
    case 'not in':
    case 'is not':
      const excludeLabelIds = Array.isArray(value) ? value : [value]
      if (excludeLabelIds.length === 0) return null
      return not(exists(
        db.select({ id: sql`1` }).from(schema.LabelsOnThread)
          .where(and(
            eq(schema.LabelsOnThread.threadId, Thread.id),
            inArray(schema.LabelsOnThread.labelId, excludeLabelIds)
          ))
      ))
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
    if (Array.isArray(v)) {
      return v.map(item => typeof item === 'object' && item !== null ? item.id : item).filter(Boolean)
    }
    return [typeof v === 'object' && v !== null ? v.id : v].filter(Boolean)
  }

  switch (operator) {
    case 'empty':
      return isNull(Thread.assigneeId)
    case 'not empty':
      return isNotNull(Thread.assigneeId)
    case 'is':
      const singleId = extractIds(value)[0]
      return singleId ? eq(Thread.assigneeId, singleId) : null
    case 'is not':
      const excludeId = extractIds(value)[0]
      return excludeId ? not(eq(Thread.assigneeId, excludeId)) : null
    case 'in':
      const ids = extractIds(value)
      return ids.length ? inArray(Thread.assigneeId, ids) : null
    case 'not in':
      const excludeIds = extractIds(value)
      return excludeIds.length ? not(inArray(Thread.assigneeId, excludeIds)) : null
    default:
      return null
  }
}

/**
 * Build inbox condition query.
 * Filters through InboxIntegration join.
 */
function buildInboxQuery(operator: Operator, value: any): SQL<unknown> | null {
  const inboxIds = Array.isArray(value) ? value : [value]

  switch (operator) {
    case 'empty':
      return not(exists(
        db.select({ id: sql`1` }).from(schema.InboxIntegration)
          .where(eq(schema.InboxIntegration.integrationId, Thread.integrationId))
      ))
    case 'not empty':
      return exists(
        db.select({ id: sql`1` }).from(schema.InboxIntegration)
          .where(eq(schema.InboxIntegration.integrationId, Thread.integrationId))
      )
    case 'in':
    case 'is':
      if (inboxIds.length === 0) return null
      return exists(
        db.select({ id: sql`1` }).from(schema.InboxIntegration)
          .where(and(
            eq(schema.InboxIntegration.integrationId, Thread.integrationId),
            inArray(schema.InboxIntegration.inboxId, inboxIds)
          ))
      )
    case 'not in':
    case 'is not':
      if (inboxIds.length === 0) return null
      return not(exists(
        db.select({ id: sql`1` }).from(schema.InboxIntegration)
          .where(and(
            eq(schema.InboxIntegration.integrationId, Thread.integrationId),
            inArray(schema.InboxIntegration.inboxId, inboxIds)
          ))
      ))
    default:
      return null
  }
}

/**
 * Build status condition query.
 */
function buildStatusQuery(operator: Operator, value: any): SQL<unknown> | null {
  switch (operator) {
    case 'is':
      return eq(Thread.status, value)
    case 'is not':
      return not(eq(Thread.status, value))
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
    return isNaN(parsed.getTime()) ? null : parsed
  }

  switch (operator) {
    case 'before':
      const beforeDate = parseDate(value)
      return beforeDate ? lt(dateColumn, beforeDate) : null
    case 'after':
      const afterDate = parseDate(value)
      return afterDate ? gt(dateColumn, afterDate) : null
    case 'on':
      const onDate = parseDate(value)
      if (!onDate) return null
      const startOfDay = new Date(onDate)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(onDate)
      endOfDay.setHours(23, 59, 59, 999)
      return and(gte(dateColumn, startOfDay), lte(dateColumn, endOfDay))
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
      return not(exists(
        db.select({ id: sql`1` }).from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .where(and(eq(Message.threadId, Thread.id), eq(MessageParticipant.role, 'FROM')))
      ))
    case 'not empty':
      return exists(
        db.select({ id: sql`1` }).from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .where(and(eq(Message.threadId, Thread.id), eq(MessageParticipant.role, 'FROM')))
      )
    case 'is':
      return exists(
        db.select({ id: sql`1` }).from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
          .where(and(
            eq(Message.threadId, Thread.id),
            eq(MessageParticipant.role, 'FROM'),
            ilike(Participant.identifier, value)
          ))
      )
    case 'is not':
      return not(exists(
        db.select({ id: sql`1` }).from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
          .where(and(
            eq(Message.threadId, Thread.id),
            eq(MessageParticipant.role, 'FROM'),
            ilike(Participant.identifier, value)
          ))
      ))
    case 'contains':
      return exists(
        db.select({ id: sql`1` }).from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
          .where(and(
            eq(Message.threadId, Thread.id),
            eq(MessageParticipant.role, 'FROM'),
            ilike(Participant.identifier, `%${value}%`)
          ))
      )
    case 'not contains':
      return not(exists(
        db.select({ id: sql`1` }).from(Message)
          .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
          .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
          .where(and(
            eq(Message.threadId, Thread.id),
            eq(MessageParticipant.role, 'FROM'),
            ilike(Participant.identifier, `%${value}%`)
          ))
      ))
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
