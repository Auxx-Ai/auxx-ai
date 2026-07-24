// packages/lib/src/ai/kopilot/capabilities/create-deps.ts

import { database } from '@auxx/database'
import type { ResolvedKnowledgeScope } from '../../../agents/resolve-knowledge-scope'
import type { CapabilityView } from '../../../permissions/capabilities/capability-view'
import type { SessionContext } from '../types'
import type { GetToolDeps, ToolDeps } from './types'

/**
 * Create a tool deps factory that provides database + org context to capability tools.
 * Used by the SSE route to bridge request context into tool execution.
 */
export function createToolDepsFactory(params: {
  organizationId: string
  userId: string
  sessionId: string
  signal?: AbortSignal
  /** UI session context from the current request body. Read by tools that need active-record ids. */
  sessionContext?: SessionContext
  /**
   * Pre-resolved read/write enforcement (v2 §3), resolved once and shared by
   * every tool call in the turn.
   *
   * As of capability layer v2 §3.2 every agent path threads this: interactive
   * Kopilot (`intersectCapabilities(agentCaps, humanCaps)`), worker agent jobs
   * and visitor chat (both via `resolveAgentRunCapabilities`).
   *
   * The `!capabilities → unrestricted` fallback inside the tools now survives
   * **solely for the workflow AI node** (`workflow-engine/nodes/action-nodes/
   * ai-v2.ts`), which is explicitly out of scope until workflows become
   * permission principals of their own (§0.8) — plus master-Kopilot job runs and
   * pre-setup drafts, which have no principal to resolve. Do not remove the
   * fallback, and do not add new callers that rely on it.
   */
  capabilities?: CapabilityView
  /**
   * The running agent's resolved retrieval scope (§1.1), resolved once and
   * shared by every tool call in the turn. Same `null`-is-unrestricted
   * semantics as {@link capabilities}. Absent for un-threaded callers.
   */
  knowledgeScope?: ResolvedKnowledgeScope | null
}): GetToolDeps {
  return (): ToolDeps => ({
    db: database,
    organizationId: params.organizationId,
    userId: params.userId,
    sessionId: params.sessionId,
    signal: params.signal,
    sessionContext: params.sessionContext ?? {},
    capabilities: params.capabilities,
    knowledgeScope: params.knowledgeScope,
  })
}
