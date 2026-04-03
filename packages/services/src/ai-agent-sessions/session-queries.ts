// packages/services/src/ai-agent-sessions/session-queries.ts

import { database, schema } from '@auxx/database'
import { and, desc, eq, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type {
  CreateSessionInput,
  FindSessionByContextInput,
  ListSessionsInput,
  SaveMessagesInput,
  UpdateDomainStateInput,
} from './types'

/**
 * Create a new agent session
 */
export async function createSession(input: CreateSessionInput) {
  const { organizationId, userId, type, title, messages, domainState } = input

  const result = await fromDatabase(
    database
      .insert(schema.AiAgentSession)
      .values({
        organizationId,
        userId,
        type,
        title,
        messages: messages ?? [],
        domainState: domainState ?? {},
        updatedAt: new Date(),
      })
      .returning(),
    'create-ai-agent-session'
  )

  if (result.isErr()) return err(result.error)

  const session = result.value[0]
  if (!session) {
    return err({
      code: 'SESSION_CREATE_FAILED' as const,
      message: 'Failed to create agent session',
    })
  }

  return ok(session)
}

/**
 * Find a session by ID within an organization
 */
export async function getSessionById(params: { sessionId: string; organizationId: string }) {
  const { sessionId, organizationId } = params

  const result = await fromDatabase(
    database.query.AiAgentSession.findFirst({
      where: (sessions, { eq, and }) =>
        and(eq(sessions.id, sessionId), eq(sessions.organizationId, organizationId)),
    }),
    'get-ai-agent-session'
  )

  if (result.isErr()) return err(result.error)

  const session = result.value
  if (!session) {
    return err({
      code: 'SESSION_NOT_FOUND' as const,
      message: `Agent session not found: ${sessionId}`,
    })
  }

  return ok(session)
}

/**
 * Find sessions by type for a user (most recent first)
 */
export async function findSessionsByType(input: ListSessionsInput) {
  const { organizationId, userId, type, limit = 50, cursor } = input
  const take = limit + 1

  const conditions = [
    eq(schema.AiAgentSession.organizationId, organizationId),
    eq(schema.AiAgentSession.userId, userId),
    eq(schema.AiAgentSession.type, type),
  ]

  if (cursor) {
    const [timestamp, id] = cursor.split('|')
    if (timestamp && id) {
      conditions.push(
        sql`(${schema.AiAgentSession.updatedAt}, ${schema.AiAgentSession.id}) < (${timestamp}::timestamp, ${id})`
      )
    }
  }

  const result = await fromDatabase(
    database
      .select({
        id: schema.AiAgentSession.id,
        title: schema.AiAgentSession.title,
        type: schema.AiAgentSession.type,
        createdAt: schema.AiAgentSession.createdAt,
        updatedAt: schema.AiAgentSession.updatedAt,
      })
      .from(schema.AiAgentSession)
      .where(and(...conditions))
      .orderBy(desc(schema.AiAgentSession.updatedAt))
      .limit(take),
    'find-ai-agent-sessions-by-type'
  )

  if (result.isErr()) return err(result.error)

  const sessions = result.value
  const hasMore = sessions.length > limit
  const items = hasMore ? sessions.slice(0, limit) : sessions
  const nextCursor =
    hasMore && items.length > 0
      ? `${items[items.length - 1]!.updatedAt.toISOString()}|${items[items.length - 1]!.id}`
      : undefined

  return ok({ items, nextCursor })
}

/**
 * Find the most recent session for a given context (type + user + org)
 */
export async function findSessionByContext(input: FindSessionByContextInput) {
  const { organizationId, userId, type } = input

  const result = await fromDatabase(
    database.query.AiAgentSession.findFirst({
      where: (sessions, { eq, and }) =>
        and(
          eq(sessions.organizationId, organizationId),
          eq(sessions.userId, userId),
          eq(sessions.type, type)
        ),
      orderBy: (sessions, { desc }) => [desc(sessions.updatedAt)],
    }),
    'find-ai-agent-session-by-context'
  )

  if (result.isErr()) return err(result.error)

  return ok(result.value ?? null)
}

/**
 * Save messages to a session (replaces entire messages array)
 */
export async function saveSessionMessages(input: SaveMessagesInput) {
  const { sessionId, organizationId, messages } = input

  const result = await fromDatabase(
    database
      .update(schema.AiAgentSession)
      .set({
        messages,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.AiAgentSession.id, sessionId),
          eq(schema.AiAgentSession.organizationId, organizationId)
        )
      )
      .returning(),
    'save-ai-agent-session-messages'
  )

  if (result.isErr()) return err(result.error)

  const session = result.value[0]
  if (!session) {
    return err({
      code: 'SESSION_NOT_FOUND' as const,
      message: `Agent session not found: ${sessionId}`,
    })
  }

  return ok(session)
}

/**
 * Update domain state for a session (replaces entire domainState object)
 */
export async function updateSessionDomainState(input: UpdateDomainStateInput) {
  const { sessionId, organizationId, domainState } = input

  const result = await fromDatabase(
    database
      .update(schema.AiAgentSession)
      .set({
        domainState,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.AiAgentSession.id, sessionId),
          eq(schema.AiAgentSession.organizationId, organizationId)
        )
      )
      .returning(),
    'update-ai-agent-session-domain-state'
  )

  if (result.isErr()) return err(result.error)

  const session = result.value[0]
  if (!session) {
    return err({
      code: 'SESSION_NOT_FOUND' as const,
      message: `Agent session not found: ${sessionId}`,
    })
  }

  return ok(session)
}

/**
 * Update session title
 */
export async function updateSessionTitle(params: {
  sessionId: string
  organizationId: string
  title: string
}) {
  const { sessionId, organizationId, title } = params

  const result = await fromDatabase(
    database
      .update(schema.AiAgentSession)
      .set({
        title,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.AiAgentSession.id, sessionId),
          eq(schema.AiAgentSession.organizationId, organizationId)
        )
      )
      .returning(),
    'update-ai-agent-session-title'
  )

  if (result.isErr()) return err(result.error)

  const session = result.value[0]
  if (!session) {
    return err({
      code: 'SESSION_NOT_FOUND' as const,
      message: `Agent session not found: ${sessionId}`,
    })
  }

  return ok(session)
}

/**
 * Delete a session
 */
export async function deleteSession(params: { sessionId: string; organizationId: string }) {
  const { sessionId, organizationId } = params

  const result = await fromDatabase(
    database
      .delete(schema.AiAgentSession)
      .where(
        and(
          eq(schema.AiAgentSession.id, sessionId),
          eq(schema.AiAgentSession.organizationId, organizationId)
        )
      )
      .returning({ id: schema.AiAgentSession.id }),
    'delete-ai-agent-session'
  )

  if (result.isErr()) return err(result.error)

  if (result.value.length === 0) {
    return err({
      code: 'SESSION_NOT_FOUND' as const,
      message: `Agent session not found: ${sessionId}`,
    })
  }

  return ok(undefined)
}
