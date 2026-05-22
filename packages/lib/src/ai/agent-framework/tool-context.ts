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
  /**
   * Workflow handle — populated only when the engine is running inside a
   * workflow AI node. Lets workflow-native tools (e.g. `assign_variable`)
   * reach the active node's execution context without the agent framework
   * having to depend on `@auxx/lib/workflow-engine`. Shape is intentionally
   * structural so a circular dependency never forms — the workflow engine
   * passes its `ExecutionContextManager` here at call time.
   */
  workflow?: WorkflowToolContext
}

/**
 * Structural view of the workflow execution context surfaced to tools. Mirrors
 * the subset of `ExecutionContextManager` (workflow-engine) that workflow-
 * native tools actually use. Declared inline so agent-framework stays free of
 * workflow-engine imports.
 */
export interface WorkflowToolContext {
  /** Id of the AI node currently executing the agent loop. */
  nodeId: string
  /**
   * Handle to the active workflow run's context manager. Tools call
   * `assignVariable(name, value)` to expose values to downstream nodes;
   * underneath, the engine maps this onto `ExecutionContextManager.setVariable`.
   */
  contextManager: {
    assignVariable: (name: string, value: unknown) => void
  }
}
