// packages/lib/src/ai/agent-framework/tool-context.ts

import type { Database } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
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
   * The ambient *records in scope* this turn operates on — the **subject** axis
   * (README "canonical context — two axes"). Surface-provided, built outside
   * kopilot from verified inputs (chat: the verified passport). Tool bindings
   * derive a record from `subject.anchors` to clamp identity/scope inputs; a
   * missing anchor is the gate. Internal / kopilot / autonomous-trigger runs
   * leave this undefined (bound inputs then fall through to the model).
   * See plans/chat/v8.
   */
  subject?: Subject
  /**
   * The agent's bound app accounts (`Agent.appAccounts`), keyed by app slug →
   * `{ credId }` (the bound connection's `WorkflowCredentials.id`). The binding
   * resolver uses it to pick the connection-scoped `CustomField` row when an
   * `@app:<slug>:<key>` var segment is resolved at turn time (plans/chat/v8
   * phase-2). Absent on runs with no bound apps.
   */
  appAccounts?: Record<string, { credId: string }>
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
 * Surface-neutral *subject* of a turn — the ambient records in scope, threaded
 * onto every tool call as `ToolContext.subject`. Generalizes the chat-only
 * `ChatInvocationContext` of v6 into "the anchor set this invocation provides",
 * with chat as the first implementer and internal kopilot the next.
 *
 * The agent never authors it, never re-derives it, never branches on
 * "anonymous" — there is just a subject where a given anchor (e.g. `contact`)
 * may be absent. See plans/chat/v8 phase-1.
 */
export interface Subject {
  /**
   * Ambient records in scope, keyed by entity-type slug → `RecordId`
   * (`toRecordId(entityType, id)` — already the form `batchGetValues` reads).
   * Chat: `{ thread, participant, contact? }` — `contact` present iff the
   * participant is linked to a *verified* contact.
   */
  anchors: Partial<Record<string, RecordId>>
  /**
   * Crypto-verified identity (chat: a verified passport). Gates nothing on its
   * own — it is the honest signal the persona layer reads to distinguish
   * "anonymous → sign in" from "verified but the field was empty".
   */
  identityVerified: boolean
  /**
   * Untrusted `identify()` claim — display / personalisation only, NEVER an
   * anchor. Because it is not in `anchors` and no `VarRef` can root at it, a
   * spoofable email is type-incapable of selecting a record. This is the
   * structural guarantee behind the v8 safety property.
   */
  claimed?: { name?: string; email?: string }
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
