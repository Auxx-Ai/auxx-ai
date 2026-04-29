// packages/lib/src/ai/agent-framework/tool-context.ts

import type { Database } from '@auxx/database'
import type { AgentDeps } from './types'

/**
 * Caller-agnostic context every tool's `execute()` receives. Built fresh by
 * each caller — chat (SSE route), worker job, headless runner, future
 * apply-time path — so tools see the same shape regardless of who invoked
 * them. Replaces what used to be the per-caller `getDeps()` closure pattern.
 *
 * `ToolContext` is a strict superset of `AgentDeps` — every chat-time field
 * is preserved, and `db` + `traceId` are added on top. This means a function
 * declared as `(_, deps: AgentDeps) => …` (e.g. agent buildMessages /
 * processResult) can still be invoked with a `ToolContext` at runtime.
 */
export interface ToolContext extends AgentDeps {
  db: Database
  /** Stable id tying this tool call to its enclosing AI run for log / audit correlation. */
  traceId?: string
}
