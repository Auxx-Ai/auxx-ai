// packages/lib/src/ai/kopilot/capabilities/create-deps.ts

import { database } from '@auxx/database'
import type { CapabilitySet } from '../../../permissions/capabilities/capability-set'
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
   * Pre-resolved read enforcement (v2 §3). Pass ONLY for interactive turns where
   * the acting user is a real org member; omit for autonomous/visitor/workflow
   * turns (they stay unrestricted). Resolved once and shared by every tool call.
   */
  capabilities?: CapabilitySet
}): GetToolDeps {
  return (): ToolDeps => ({
    db: database,
    organizationId: params.organizationId,
    userId: params.userId,
    sessionId: params.sessionId,
    signal: params.signal,
    sessionContext: params.sessionContext ?? {},
    capabilities: params.capabilities,
  })
}
