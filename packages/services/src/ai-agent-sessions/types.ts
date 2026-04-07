// packages/services/src/ai-agent-sessions/types.ts

/**
 * Base context for all ai-agent-session operations
 */
export interface SessionContext {
  organizationId: string
  userId: string
}

/**
 * Input for creating a new agent session
 */
export interface CreateSessionInput extends SessionContext {
  type: string
  title?: string
  modelId?: string | null
  messages?: Record<string, unknown>[]
  domainState?: Record<string, unknown>
}

/**
 * Input for updating session messages
 */
export interface SaveMessagesInput {
  sessionId: string
  organizationId: string
  messages: Record<string, unknown>[]
}

/**
 * Input for updating domain state
 */
export interface UpdateDomainStateInput {
  sessionId: string
  organizationId: string
  domainState: Record<string, unknown>
}

/**
 * Input for listing sessions by type
 */
export interface ListSessionsInput extends SessionContext {
  type: string
  limit?: number
  cursor?: string
}

/**
 * Input for finding a session by context (type + user + org)
 */
export interface FindSessionByContextInput extends SessionContext {
  type: string
}
