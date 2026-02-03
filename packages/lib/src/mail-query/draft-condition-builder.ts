// packages/lib/src/mail-query/draft-condition-builder.ts

import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { schema } from '@auxx/database'
import type { Condition, ConditionGroup } from '../conditions/types'
import type { Operator } from '../conditions/operator-definitions'

const { Draft } = schema

/**
 * Fields that can be applied to standalone drafts.
 */
const SUPPORTED_DRAFT_FIELDS = ['subject', 'body', 'hasAttachments', 'to', 'date', 'freeText']

/**
 * Fields that cannot be applied to drafts (they don't have these attributes).
 * When any of these are present, standalone drafts should be excluded from results.
 *
 * Note: 'hasDraft' and 'status' are NOT in this list because:
 * - hasDraft: Is the DRAFTS context trigger, should include drafts
 * - status: Filters threads only; drafts are implicitly not TRASH/SPAM
 */
const UNSUPPORTED_DRAFT_FIELDS = [
  'tag',
  'assignee',
  'inbox',
  'sender',
  'from',
  'sent',
]

/**
 * Check if condition groups contain any unsupported draft conditions.
 * If so, standalone drafts should be excluded from results.
 */
export function hasUnsupportedDraftConditions(groups: ConditionGroup[]): boolean {
  for (const group of groups) {
    for (const condition of group.conditions) {
      if (UNSUPPORTED_DRAFT_FIELDS.includes(condition.fieldId as string)) {
        return true
      }
    }
  }
  return false
}

/**
 * Check if the condition groups represent a DRAFTS context query.
 * DRAFTS context is identified by hasDraft=true condition.
 */
export function isDraftsContextQuery(groups: ConditionGroup[]): boolean {
  return groups.some((group) =>
    group.conditions.some((c) => c.fieldId === 'hasDraft' && c.value === true)
  )
}

/**
 * Build WHERE clause for Draft table from condition groups.
 * Only includes supported conditions - caller should check hasUnsupportedDraftConditions first.
 */
export function buildDraftConditions(
  groups: ConditionGroup[],
  organizationId: string,
  userId: string
): SQL {
  // Base conditions: org, user, standalone (no threadId)
  const baseConditions = and(
    eq(Draft.organizationId, organizationId),
    eq(Draft.createdById, userId),
    isNull(Draft.threadId)
  )!

  // Extract and build supported conditions
  const supportedConditions = groups
    .flatMap((g) => g.conditions)
    .filter((c) => SUPPORTED_DRAFT_FIELDS.includes(c.fieldId as string))
    .map((c) => buildDraftCondition(c))
    .filter((c): c is SQL => c !== null)

  if (supportedConditions.length === 0) {
    return baseConditions
  }

  return and(baseConditions, ...supportedConditions)!
}

/**
 * Build SQL condition for a single draft field.
 */
function buildDraftCondition(condition: Condition): SQL | null {
  const { fieldId, operator, value, metadata } = condition
  const op = operator as Operator

  switch (fieldId) {
    case 'subject':
      return buildDraftSubjectCondition(op, value)
    case 'body':
      return buildDraftBodyCondition(op, value)
    case 'hasAttachments':
      return buildDraftAttachmentsCondition(op, value)
    case 'to':
      return buildDraftRecipientsCondition(op, value)
    case 'date':
      return buildDraftDateCondition(op, value, metadata?.field)
    case 'freeText':
      return buildDraftFreeTextCondition(op, value)
    default:
      return null
  }
}

/**
 * Build subject condition for drafts.
 */
function buildDraftSubjectCondition(operator: Operator, value: any): SQL | null {
  const subjectPath = sql`${Draft.content}->>'subject'`

  switch (operator) {
    case 'is':
      return sql`${subjectPath} ILIKE ${value}`
    case 'is not':
      return sql`${subjectPath} NOT ILIKE ${value}`
    case 'contains':
      return sql`${subjectPath} ILIKE ${'%' + value + '%'}`
    case 'not contains':
      return sql`${subjectPath} NOT ILIKE ${'%' + value + '%'}`
    case 'empty':
      return sql`(${subjectPath} IS NULL OR ${subjectPath} = '')`
    case 'not empty':
      return sql`(${subjectPath} IS NOT NULL AND ${subjectPath} != '')`
    default:
      return null
  }
}

/**
 * Build body condition for drafts.
 */
function buildDraftBodyCondition(operator: Operator, value: any): SQL | null {
  const bodyTextPath = sql`${Draft.content}->>'bodyText'`
  const bodyHtmlPath = sql`${Draft.content}->>'bodyHtml'`

  switch (operator) {
    case 'contains':
      return sql`(${bodyTextPath} ILIKE ${'%' + value + '%'} OR ${bodyHtmlPath} ILIKE ${'%' + value + '%'})`
    case 'not contains':
      return sql`(${bodyTextPath} NOT ILIKE ${'%' + value + '%'} AND ${bodyHtmlPath} NOT ILIKE ${'%' + value + '%'})`
    default:
      return null
  }
}

/**
 * Build hasAttachments condition for drafts.
 */
function buildDraftAttachmentsCondition(operator: Operator, value: any): SQL | null {
  const hasAttachments = value === true || value === 'true'
  const attachmentsPath = sql`${Draft.content}->'attachments'`

  if (hasAttachments) {
    return sql`(jsonb_array_length(${attachmentsPath}) > 0)`
  } else {
    return sql`(${attachmentsPath} IS NULL OR jsonb_array_length(${attachmentsPath}) = 0)`
  }
}

/**
 * Build recipients (to) condition for drafts.
 */
function buildDraftRecipientsCondition(operator: Operator, value: any): SQL | null {
  const recipientsPath = sql`${Draft.content}->'recipients'->'to'`

  switch (operator) {
    case 'is':
    case 'contains':
      return sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${recipientsPath}) AS r
        WHERE r->>'identifier' ILIKE ${'%' + value + '%'}
      )`
    case 'is not':
    case 'not contains':
      return sql`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${recipientsPath}) AS r
        WHERE r->>'identifier' ILIKE ${'%' + value + '%'}
      )`
    default:
      return null
  }
}

/**
 * Build date condition for drafts.
 */
function buildDraftDateCondition(
  operator: Operator,
  value: any,
  field?: string
): SQL | null {
  const dateColumn = field === 'createdAt' ? Draft.createdAt : Draft.updatedAt
  const dateValue = new Date(value)

  if (isNaN(dateValue.getTime())) return null

  switch (operator) {
    case 'before':
      return sql`${dateColumn} < ${dateValue}`
    case 'after':
      return sql`${dateColumn} > ${dateValue}`
    case 'is': {
      const startOfDay = new Date(dateValue)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(dateValue)
      endOfDay.setHours(23, 59, 59, 999)
      return sql`${dateColumn} >= ${startOfDay} AND ${dateColumn} <= ${endOfDay}`
    }
    default:
      return null
  }
}

/**
 * Build free text search condition for drafts.
 */
function buildDraftFreeTextCondition(operator: Operator, value: any): SQL | null {
  if (!value) return null

  const subjectPath = sql`${Draft.content}->>'subject'`
  const bodyTextPath = sql`${Draft.content}->>'bodyText'`
  const searchTerm = '%' + value + '%'

  return sql`(${subjectPath} ILIKE ${searchTerm} OR ${bodyTextPath} ILIKE ${searchTerm})`
}
