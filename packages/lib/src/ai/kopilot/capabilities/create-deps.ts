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
   * **REQUIRED KEY, nullable value — deliberately.** The property was optional
   * (`capabilities?:`) until plan 19 step 3. Because the tools treat a missing
   * value as *unrestricted*, an omitted property was a silent, invisible
   * authorization bypass — and three approval runners had in fact omitted it,
   * making the whole published-policy gate inert on those paths without a single
   * compile error to show for it. Requiring the key (while still allowing
   * `undefined`) turns every bypass into something a reader and a reviewer can
   * see at the call site, and turns a NEW omission into a type error.
   *
   * Every agent path threads a real view: interactive Kopilot (human ∩ published
   * agent policy), worker agent jobs, visitor chat, and eval runs (all via
   * `resolveAgentRunCapabilities`).
   *
   * Pass `undefined` ONLY where there is genuinely no principal to resolve, and
   * say why in a comment at the call site: the workflow AI node (workflows are not
   * permission principals yet — doc 14 §0.8), master-Kopilot job runs, and
   * pre-setup drafts.
   */
  capabilities: CapabilityView | undefined
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
