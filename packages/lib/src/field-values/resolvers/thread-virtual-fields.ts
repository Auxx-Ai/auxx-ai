// packages/lib/src/field-values/resolvers/thread-virtual-fields.ts

import { schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { FieldValueContext } from '../field-value-helpers'

const { Thread, Message, MessageParticipant, Participant, Draft } = schema

type VirtualFieldMap = Map<string, Map<string, TypedFieldValue>>

/**
 * Resolve thread virtual fields that require cross-table joins.
 *
 * These fields have dbColumn: undefined in the registry and need
 * multi-table queries to compute values.
 *
 * Read semantics intentionally differ from filter semantics:
 * - Filters check if ANY matching message exists (broad matching)
 * - Reads return a specific display value (first sender, latest body, etc.)
 *
 * @param fieldIdMap - Maps field key → actual field UUID for result construction
 * @returns Map<entityId, Map<fieldKey, TypedFieldValue>>
 */
export async function resolveThreadVirtualFields(
  ctx: FieldValueContext,
  entityIds: string[],
  fieldKeys: string[],
  fieldIdMap: Map<string, string>
): Promise<VirtualFieldMap> {
  if (entityIds.length === 0 || fieldKeys.length === 0) return new Map()

  const keySet = new Set(fieldKeys)

  // Run all needed resolvers in parallel
  const resolverPromises: Array<Promise<void>> = []
  const result: VirtualFieldMap = new Map()

  if (keySet.has('from')) {
    resolverPromises.push(resolveFrom(ctx, entityIds, fieldIdMap, result))
  }
  if (keySet.has('to')) {
    resolverPromises.push(resolveTo(ctx, entityIds, fieldIdMap, result))
  }
  if (keySet.has('body')) {
    resolverPromises.push(resolveBody(ctx, entityIds, fieldIdMap, result))
  }
  if (keySet.has('hasAttachments')) {
    resolverPromises.push(resolveHasAttachments(ctx, entityIds, fieldIdMap, result))
  }
  if (keySet.has('hasDraft')) {
    resolverPromises.push(resolveHasDraft(ctx, entityIds, fieldIdMap, result))
  }
  if (keySet.has('sent')) {
    resolverPromises.push(resolveSent(ctx, entityIds, fieldIdMap, result))
  }

  await Promise.all(resolverPromises)

  return result
}

// =============================================================================
// HELPERS
// =============================================================================

function buildBase(entityId: string, fieldKey: string, fieldIdMap: Map<string, string>) {
  return {
    id: `virtual_${entityId}_${fieldKey}`,
    entityId,
    fieldId: fieldIdMap.get(fieldKey) ?? fieldKey,
    sortKey: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function setFieldValue(
  result: VirtualFieldMap,
  entityId: string,
  fieldKey: string,
  value: TypedFieldValue
) {
  let fieldMap = result.get(entityId)
  if (!fieldMap) {
    fieldMap = new Map()
    result.set(entityId, fieldMap)
  }
  fieldMap.set(fieldKey, value)
}

// =============================================================================
// INDIVIDUAL RESOLVERS
// =============================================================================

/**
 * From — sender email of the first inbound message.
 */
async function resolveFrom(
  ctx: FieldValueContext,
  entityIds: string[],
  fieldIdMap: Map<string, string>,
  result: VirtualFieldMap
): Promise<void> {
  const rows = await ctx.db
    .selectDistinctOn([Message.threadId], {
      threadId: Message.threadId,
      identifier: Participant.identifier,
    })
    .from(Message)
    .innerJoin(Participant, eq(Participant.id, Message.fromId))
    .where(
      and(
        inArray(Message.threadId, entityIds),
        eq(Message.organizationId, ctx.organizationId),
        eq(Message.isFirstInThread, true)
      )
    )
    .orderBy(Message.threadId, Message.createdAt)

  for (const row of rows) {
    if (!row.identifier) continue
    setFieldValue(result, row.threadId, 'from', {
      ...buildBase(row.threadId, 'from', fieldIdMap),
      type: 'text',
      value: row.identifier,
    } as TypedFieldValue)
  }
}

/**
 * To — comma-separated recipient emails from the first inbound message.
 */
async function resolveTo(
  ctx: FieldValueContext,
  entityIds: string[],
  fieldIdMap: Map<string, string>,
  result: VirtualFieldMap
): Promise<void> {
  const rows = await ctx.db
    .select({
      threadId: Message.threadId,
      recipients: sql<string>`string_agg(DISTINCT ${Participant.identifier}, ', ')`,
    })
    .from(Message)
    .innerJoin(MessageParticipant, eq(MessageParticipant.messageId, Message.id))
    .innerJoin(Participant, eq(Participant.id, MessageParticipant.participantId))
    .where(
      and(
        inArray(Message.threadId, entityIds),
        eq(Message.organizationId, ctx.organizationId),
        eq(Message.isFirstInThread, true),
        inArray(MessageParticipant.role, ['TO', 'CC', 'BCC'])
      )
    )
    .groupBy(Message.threadId)

  for (const row of rows) {
    if (!row.recipients) continue
    setFieldValue(result, row.threadId, 'to', {
      ...buildBase(row.threadId, 'to', fieldIdMap),
      type: 'text',
      value: row.recipients,
    } as TypedFieldValue)
  }
}

/**
 * Body — latest message body via Thread.latestMessageId.
 * Prefers textPlain, falls back to textHtml.
 */
async function resolveBody(
  ctx: FieldValueContext,
  entityIds: string[],
  fieldIdMap: Map<string, string>,
  result: VirtualFieldMap
): Promise<void> {
  const rows = await ctx.db
    .select({
      threadId: Thread.id,
      textPlain: Message.textPlain,
      textHtml: Message.textHtml,
    })
    .from(Thread)
    .innerJoin(Message, eq(Message.id, Thread.latestMessageId))
    .where(and(inArray(Thread.id, entityIds), eq(Thread.organizationId, ctx.organizationId)))

  for (const row of rows) {
    const body = row.textPlain || row.textHtml
    if (!body) continue
    setFieldValue(result, row.threadId, 'body', {
      ...buildBase(row.threadId, 'body', fieldIdMap),
      type: 'text',
      value: body,
    } as TypedFieldValue)
  }
}

/**
 * HasAttachments — whether any message in the thread has attachments.
 * Returns boolean for all entity IDs (true if found, false otherwise).
 */
async function resolveHasAttachments(
  ctx: FieldValueContext,
  entityIds: string[],
  fieldIdMap: Map<string, string>,
  result: VirtualFieldMap
): Promise<void> {
  const rows = await ctx.db
    .selectDistinctOn([Message.threadId], { threadId: Message.threadId })
    .from(Message)
    .where(
      and(
        inArray(Message.threadId, entityIds),
        eq(Message.organizationId, ctx.organizationId),
        eq(Message.hasAttachments, true)
      )
    )

  const withAttachments = new Set(rows.map((r) => r.threadId))

  for (const entityId of entityIds) {
    setFieldValue(result, entityId, 'hasAttachments', {
      ...buildBase(entityId, 'hasAttachments', fieldIdMap),
      type: 'boolean',
      value: withAttachments.has(entityId),
    } as TypedFieldValue)
  }
}

/**
 * HasDraft — whether the thread has a draft reply.
 */
async function resolveHasDraft(
  ctx: FieldValueContext,
  entityIds: string[],
  fieldIdMap: Map<string, string>,
  result: VirtualFieldMap
): Promise<void> {
  const rows = await ctx.db
    .selectDistinctOn([Draft.threadId], { threadId: Draft.threadId })
    .from(Draft)
    .where(and(inArray(Draft.threadId, entityIds), eq(Draft.organizationId, ctx.organizationId)))

  const withDraft = new Set(rows.map((r) => r.threadId))

  for (const entityId of entityIds) {
    setFieldValue(result, entityId, 'hasDraft', {
      ...buildBase(entityId, 'hasDraft', fieldIdMap),
      type: 'boolean',
      value: withDraft.has(entityId),
    } as TypedFieldValue)
  }
}

/**
 * Sent — whether the thread has any outbound (sent) message.
 */
async function resolveSent(
  ctx: FieldValueContext,
  entityIds: string[],
  fieldIdMap: Map<string, string>,
  result: VirtualFieldMap
): Promise<void> {
  const rows = await ctx.db
    .selectDistinctOn([Message.threadId], { threadId: Message.threadId })
    .from(Message)
    .where(
      and(
        inArray(Message.threadId, entityIds),
        eq(Message.organizationId, ctx.organizationId),
        eq(Message.isInbound, false)
      )
    )

  const withSent = new Set(rows.map((r) => r.threadId))

  for (const entityId of entityIds) {
    setFieldValue(result, entityId, 'sent', {
      ...buildBase(entityId, 'sent', fieldIdMap),
      type: 'boolean',
      value: withSent.has(entityId),
    } as TypedFieldValue)
  }
}
