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
  /**
   * User-authored agent the session targets. Null/omitted = master Kopilot.
   */
  agentId?: string | null
  /**
   * Trigger row that kicked off this session. Drives the "Recent runs for
   * this trigger" view in the agent detail UI.
   */
  agentTriggerId?: string | null
  /**
   * Workflow the session belongs to. Set only by the workflow builder's
   * Kopilot panel; null/omitted everywhere else.
   */
  workflowAppId?: string | null
  /**
   * Kind-specific context captured at fire time. Shape per kind documented
   * on the `AiAgentSession.triggerContext` column.
   */
  triggerContext?: Record<string, unknown> | null
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
  /** Optional agent filter — when set, only sessions bound to this agent are returned. */
  agentId?: string
  /**
   * Three-state workflow filter:
   *   `undefined` — no filter (every caller that predates workflow scoping),
   *   `null`      — only sessions NOT bound to a workflow (the global picker),
   *   `<id>`      — only that workflow's builder threads.
   */
  workflowAppId?: string | null
  limit?: number
  cursor?: string
}

/**
 * Input for finding a session by context (type + user + org)
 */
export interface FindSessionByContextInput extends SessionContext {
  type: string
}
