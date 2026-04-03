// packages/lib/src/ai/kopilot/capabilities/create-deps.ts

import { database } from '@auxx/database'
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
}): GetToolDeps {
  return (): ToolDeps => ({
    db: database,
    organizationId: params.organizationId,
    userId: params.userId,
    sessionId: params.sessionId,
    signal: params.signal,
  })
}
