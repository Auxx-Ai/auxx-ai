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
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { Operator } from '../conditions/operator-definitions'
import type { Condition, ConditionGroup } from '../conditions/types'
import {
  threadDoesNotHaveTags,
  threadHasAnyTags,
  threadHasNoTags,
  threadHasTags,
} from '../field-values/relationship-queries'
import { createScopedLogger } from '../logger'
import type { MailViewer } from '../permissions/visibility/context'
import { tokenizeFreeText } from './free-text-terms'
import { threadBodySearchPredicate, threadSubjectSearchPredicate } from './thread-search-sql'
import {
  buildMailVisibilityPredicate,
  buildSearchScopes,
  type MailSearchScopes,
} from './visibility-scope'

const logger = createScopedLogger('condition-query-builder')

/**
 * Normalize drizzle's "no clause" (`undefined`, returned by `and()` / `or()`
 * when every operand is undefined) onto this builder's own sentinel (`null`).
 *
 * Both are falsy, so the `.filter(Boolean)` call sites in `buildGroupQuery` /
 * `buildConditionGroupsQueryWithDiagnostics` behave identically — this is a
 * type-level normalization at the drizzle boundary, not a change to which
 * clauses survive.
 */
function toClause(built: SQL<unknown> | undefined): SQL<unknown> | null {
  return built ?? null
}

/** Why a condition produced no SQL. */
export type DroppedConditionReason =
  /** `fieldId` is not one this builder knows how to dispatch. */
  | 'unknown-field'
  /** The field builder ran but the operator/value combination yielded no clause. */
  | 'unsupported-operator-or-value'
  /** `valueSource` was not substituted upstream by `resolveConditionContext`. */
  | 'unresolved-value-source'
  /** The field builder threw. */
  | 'build-error'

/** A single condition the builder could not turn into SQL. */
export interface DroppedCondition {
  conditionId: string
  fieldId: string
  operator: string
  reason: DroppedConditionReason
  /** Present for `build-error` only — the thrown message. */
  detail?: string
}

/**
 * Outcome of a condition-group build: the WHERE clause plus enough information
 * to tell "the caller asked for no filter" apart from "every filter the caller
 * asked for was silently dropped".
 *
 * Both cases produce the same `sql` (the bare `baseScope` — the viewer's whole
 * visible mailbox). That is correct for the mail list, saved views, unread
 * counts and the workflow Find node, and *wrong* for an AI tool, which must
 * refuse rather than answer a different question. The discriminant is
 * `allConditionsDropped`; the builder itself never throws.
 */
export interface ConditionGroupsQueryResult {
  /** The WHERE clause. Always includes the mandatory base scope + visibility. */
  sql: SQL<unknown>
  /** Total number of conditions across every input group, before building. */
  requestedConditions: number
  /** Every condition that produced no SQL, in input order. */
  droppedConditions: DroppedCondition[]
  /**
   * `true` only when at least one condition was requested and *none* of them
   * produced SQL — i.e. `sql` is the unfiltered base scope while the caller
   * asked to filter. `false` for the genuine no-filter case (`groups: []`, or
   * groups whose `conditions` arrays are empty).
   */
  allConditionsDropped: boolean
}

/**
 * Build Drizzle WHERE condition from ConditionGroup[], with drop diagnostics.
 * Groups are combined with AND at the top level.
 *
 * Every query declares its `viewer` (mail-permissions §5.1): the mandatory
 * visibility predicate is AND-ed into the base scope, and content-bearing
 * conditions (subject/body/freeText) are additionally scoped per §5.3 so a
 * filter can't be used to probe content the viewer may not read.
 *
 * Prefer this over {@link buildConditionGroupsQuery} anywhere a dropped filter
 * must be a visible failure rather than a wider result set.
 */
export function buildConditionGroupsQueryWithDiagnostics(
  groups: ConditionGroup[],
  organizationId: string,
  viewer: MailViewer
): ConditionGroupsQueryResult {
  // Hide soft-merged threads from every list view. The corresponding partial
  // index on Thread keeps this filter free for the hot pagination path.
  const visibility = buildMailVisibilityPredicate(viewer)
  const baseScope = and(
    eq(Thread.organizationId, organizationId),
    isNull(Thread.mergedIntoThreadId),
    ...(visibility ? [visibility] : [])
  )!

  if (groups.length === 0) {
    return {
      sql: baseScope,
      requestedConditions: 0,
      droppedConditions: [],
      allConditionsDropped: false,
    }
  }

  const requestedConditions = groups.reduce((sum, group) => sum + group.conditions.length, 0)
  const droppedConditions: DroppedCondition[] = []

  const scopes = buildSearchScopes(viewer)
  const groupConditions = groups.map((group) =>
    buildGroupQuery(group, organizationId, scopes, droppedConditions)
  )
  const validConditions = groupConditions.filter(Boolean) as SQL<unknown>[]

  // `requestedConditions > 0` is what keeps the genuine no-filter case
  // (empty groups) reported as "not dropped" — the UI callers depend on it.
  const allConditionsDropped = requestedConditions > 0 && validConditions.length === 0

  if (validConditions.length === 0) {
    return { sql: baseScope, requestedConditions, droppedConditions, allConditionsDropped }
  }

  // Groups combined with AND
  return {
    sql: and(baseScope, ...validConditions)!,
    requestedConditions,
    droppedConditions,
    allConditionsDropped,
  }
}

/**
 * Build Drizzle WHERE condition from ConditionGroup[].
 *
 * Thin projection of {@link buildConditionGroupsQueryWithDiagnostics} — the
 * clause only. Dropped conditions widen the result set silently, which is the
 * intended behaviour for UI surfaces (a stored view naming a retired field
 * still renders) but not for AI tools.
 */
export function buildConditionGroupsQuery(
  groups: ConditionGroup[],
  organizationId: string,
  viewer: MailViewer
): SQL<unknown> {
  return buildConditionGroupsQueryWithDiagnostics(groups, organizationId, viewer).sql
}

/**
 * Build query for a single ConditionGroup.
 */
function buildGroupQuery(
  group: ConditionGroup,
  organizationId: string,
  scopes: MailSearchScopes,
  dropped: DroppedCondition[]
): SQL<unknown> | null {
  const conditions = group.conditions
    .map((c) => buildConditionQuery(c, organizationId, scopes, dropped))
    .filter(Boolean) as SQL<unknown>[]

  if (conditions.length === 0) return null
  if (conditions.length === 1) return conditions[0] ?? null

  // Group-level operator: every surviving condition in the group is combined
  // with the SAME operator, so dropping a condition above can never shift which
  // operator a later clause is joined with.
  return group.logicalOperator === 'AND' ? and(...conditions)! : or(...conditions)!
}

/** AND a §5.3 search scope onto a built condition (no scope → pass through). */
function withScope(
  condition: SQL<unknown> | null,
  scope: SQL<unknown> | undefined
): SQL<unknown> | null {
  if (!condition || !scope) return condition
  return and(condition, scope)!
}

/**
 * Sentinel returned by {@link dispatchConditionQuery} for a `fieldId` this
 * builder has no case for. Distinct from `null`, which means "known field, but
 * this operator/value produced no clause" — the two are different failures and
 * the diagnostics report them separately.
 */
const UNKNOWN_FIELD = Symbol('unknown-field')

/**
 * Build query for a single Condition, recording a {@link DroppedCondition} on
 * `dropped` whenever no SQL comes out.
 */
function buildConditionQuery(
  condition: Condition,
  organizationId: string,
  scopes: MailSearchScopes,
  dropped: DroppedCondition[]
): SQL<unknown> | null {
  const { fieldId, operator, value, metadata } = condition
  const record = (reason: DroppedConditionReason, detail?: string) => {
    dropped.push({
      conditionId: condition.id,
      fieldId: String(fieldId),
      operator: String(operator),
      reason,
      ...(detail ? { detail } : {}),
    })
  }

  // Belt-and-suspenders: valueSource must be resolved upstream via
  // resolveConditionContext before reaching this builder.
  if (condition.valueSource) {
    logger.warn(
      `Dropping condition with unresolved valueSource '${condition.valueSource}' (${condition.fieldId}) — should be substituted upstream`
    )
    record('unresolved-value-source')
    return null
  }

  const op = operator as Operator

  let built: SQL<unknown> | null | typeof UNKNOWN_FIELD
  try {
    built = dispatchConditionQuery(fieldId, op, value, metadata, organizationId, scopes)
  } catch (error: any) {
    logger.error(`Error building condition for ${fieldId}`, { error: error.message })
    record('build-error', error?.message)
    return null
  }

  if (built === UNKNOWN_FIELD) {
    logger.warn(`Unknown fieldId: ${fieldId}`)
    record('unknown-field')
    return null
  }
  if (built === null) {
    record('unsupported-operator-or-value')
    return null
  }
  return built
}

/**
 * Dispatch a condition onto its field builder. Returns `UNKNOWN_FIELD` for an
 * unrecognized `fieldId`, `null` when the field builder declined the
 * operator/value, and the clause otherwise. Throws whatever a field builder
 * throws — the caller converts that into a `build-error` drop.
 */
function dispatchConditionQuery(
  fieldId: Condition['fieldId'],
  op: Operator,
  value: unknown,
  metadata: Condition['metadata'],
  organizationId: string,
  scopes: MailSearchScopes
): SQL<unknown> | null | typeof UNKNOWN_FIELD {
  switch (fieldId) {
    case 'tag':
    // `tags` is the key `THREAD_FIELDS` declares (and therefore what every
    // registry-driven filter surface sends); `tag` is this builder's own older
    // name, still emitted by `context-to-conditions`. Both mean the same
    // filter.
    case 'tags':
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
      return withScope(buildSubjectQuery(op, value), scopes.subject)
    case 'body':
      return withScope(buildBodyQuery(op, value), scopes.body)
    case 'before':
      return buildBeforeQuery(op, value)
    case 'after':
      return buildAfterQuery(op, value)
    case 'ticket':
      return buildTicketQuery(op, value)
    case 'hasAttachments':
      return buildHasAttachmentsQuery(op, value)
    case 'sharedWithMe':
      return buildSharedWithMeQuery(op, value, scopes.sharedThreadIds)
    case 'freeText':
      return buildFreeTextQuery(op, value, scopes)
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
      return UNKNOWN_FIELD
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
  const [onlyInboxId] = inboxIds

  switch (operator) {
    case 'empty':
      return isNull(Thread.inboxId)
    case 'not empty':
      return isNotNull(Thread.inboxId)
    case 'is':
      if (inboxIds.length === 0) return null
      if (inboxIds.length === 1 && onlyInboxId !== undefined) return eq(Thread.inboxId, onlyInboxId)
      return inArray(Thread.inboxId, inboxIds)
    case 'in':
      if (inboxIds.length === 0) return null
      return inArray(Thread.inboxId, inboxIds)
    case 'is not':
      if (inboxIds.length === 0) return null
      if (inboxIds.length === 1 && onlyInboxId !== undefined)
        return not(eq(Thread.inboxId, onlyInboxId))
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
    return toClause(or(...conditions))
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
      return toClause(and(gte(dateColumn, startOfDay), lte(dateColumn, endOfDay)))
    }
    case 'is not':
    case 'not_on_date': {
      const isNotDate = parseDate(value)
      if (!isNotDate) return null
      const startOfDay = new Date(isNotDate)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(isNotDate)
      endOfDay.setHours(23, 59, 59, 999)
      return toClause(or(lt(dateColumn, startOfDay), gt(dateColumn, endOfDay)))
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
      return toClause(or(isNull(Thread.subject), eq(Thread.subject, '')))
    case 'not empty':
      return toClause(and(isNotNull(Thread.subject), not(eq(Thread.subject, ''))))
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
  const isTrue = value === true || value === 'true'
  const hasAttachments = operator === 'is not' ? !isTrue : isTrue

  const subquery = db
    .select({ id: sql`1` })
    .from(Message)
    .where(and(eq(Message.threadId, Thread.id), eq(Message.hasAttachments, true)))

  return hasAttachments ? exists(subquery) : not(exists(subquery))
}

/**
 * Build a condition for threads explicitly shared with the viewer.
 * The grant ids are precomputed from the cached visibility context.
 */
function buildSharedWithMeQuery(
  operator: Operator,
  value: unknown,
  ids: string[]
): SQL<unknown> | null {
  const isTrue = value === true || value === 'true'
  const wantShared = operator === 'is not' ? !isTrue : isTrue
  if (ids.length === 0) return wantShared ? sql`false` : null

  const isShared = inArray(Thread.id, ids)
  return wantShared ? isShared : not(isShared)
}

/**
 * Build free text search query.
 *
 * Searches across the subject and the thread's message-body corpus. Each half
 * carries its own §5.3 scope: subject matches count only on subject-visible
 * threads (`identity`), body matches only on content-visible ones (`read`).
 * **That gradation is why there are two blocks and two bindings** — a single
 * blended predicate would let a subject-only viewer match on body text.
 *
 * **The query is tokenized: every term must match, each one in the subject OR
 * in the body corpus.** Before step 2.2 this matched the whole query as one
 * substring (`%order refund%`), so any multi-word query returned zero rows
 * unless those exact words appeared adjacent in that exact order — a bug the
 * mail search box and the ⌘K palette hit as hard as the AI does, since both feed
 * this same `freeText contains` condition. Terms may land in *different*
 * messages of the same thread; the unit of the answer is the thread.
 *
 * **Each block now comes from the shared ranked builder**
 * (`mail-query/thread-search-sql.ts` → `search/text-search-sql.ts`), so mail and
 * records share one ranking formula, one OR-block shape and one index strategy.
 * The predicate is stemmed (`refund` finds `refunds`) and typo-tolerant on the
 * subject, and it is served by the org-scoped composite GIN indexes added in
 * migration `0320_thread_search_text.sql` — measured on the dev org, a two-term
 * query (`order refund`) went from 2,004 ms — a sequential scan with one
 * correlated `EXISTS` over `Message` per term — to 138 ms on a `BitmapOr` of
 * four index scans.
 *
 * **Two behaviour changes fall out of that, and both are deliberate:**
 * - Matching is by stemmed *word*, not substring, so `fund` no longer matches
 *   `refund`. Restoring that would mean an `ILIKE '%q%'` arm, which makes the
 *   whole OR block unindexable and returns the query to a sequential scan.
 * - Recall over bodies is capped by the corpus, not the formula — see the bounds
 *   in `thread-search-text.ts` (measured at 98.6% of unbounded recall).
 */
function buildFreeTextQuery(
  operator: Operator,
  value: any,
  scopes: MailSearchScopes
): SQL<unknown> | null {
  if (value === null || value === undefined || value === '') return null

  const terms = tokenizeFreeText(String(value))
  if (terms.length === 0) return null

  const termClauses: SQL<unknown>[] = []
  for (const term of terms) {
    const subjectMatch = withScope(threadSubjectSearchPredicate(term), scopes.subject)
    const bodyMatch = withScope(threadBodySearchPredicate(term), scopes.body)

    // Term matches in the subject OR in the body corpus. Both halves are built
    // from a non-null predicate, so `withScope` always returns a clause here;
    // the fallback only guards a future scope change.
    const clause =
      !subjectMatch || !bodyMatch
        ? (subjectMatch ?? bodyMatch)
        : toClause(or(subjectMatch, bodyMatch))
    if (clause) termClauses.push(clause)
  }

  if (termClauses.length === 0) return null
  if (termClauses.length === 1) return termClauses[0] ?? null
  // Every term must match — AND, not OR. An OR would rank-lessly return every
  // thread mentioning any one word, which at mailbox scale is "everything".
  return toClause(and(...termClauses))
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
 * in, not in, empty, not empty.
 *
 * `exists` / `not exists` are commented out of `OPERATOR_DEFINITIONS` (so they
 * are not in the `Operator` union) but can still turn up in conditions that were
 * persisted as jsonb before they were retired. They are aliased onto their
 * surviving equivalents rather than falling through to `default` — dropping the
 * clause would silently widen an AND group's result set.
 */
function buildDirectColumnQuery(
  operator: Operator,
  value: any,
  column: AnyPgColumn
): SQL<unknown> | null {
  const legacyOperator: string = operator
  const op: Operator =
    legacyOperator === 'exists' ? 'not empty' : legacyOperator === 'not exists' ? 'empty' : operator

  switch (op) {
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
      return toClause(or(isNull(column), eq(column, '')))
    case 'not empty':
      return toClause(and(isNotNull(column), not(eq(column, ''))))
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
