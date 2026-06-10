// packages/lib/src/ai/kopilot/task-notifications/types.ts
//
// Generic async-task continuation for Kopilot tools: a tool fires background
// work, returns a `TaskNotificationRef`, and when the work reaches a terminal
// state the client injects a server-built `<task-notification>` message that
// starts a new turn. See plans/kopilot/task-notifications/plan.md.

/**
 * Marker a tool includes in its output to opt into async-task continuation.
 * The client registers a watch for `(kind, ref)` when this field streams in.
 */
export interface TaskNotificationRef {
  /** Registered kind, e.g. 'eval-suite'. Must have a server-side handler. */
  kind: string
  /** Kind-scoped task id, e.g. an EvalSuiteRun id. */
  ref: string
}

/** Opaque task state loaded by a kind handler; narrowed inside the handler. */
export type TaskSnapshot = Record<string, unknown>

/** Server-built, model-facing notification content. Never client-supplied. */
export interface TaskNotificationSummary {
  /** Terminal status word, e.g. 'completed' | 'cancelled' | 'error'. */
  status: string
  /** One-line outcome headline, e.g. "5 runs: 4 passed · 1 failed". */
  summary: string
  /** What the model should do next — and what it must not do (no self-restart). */
  instruction: string
}

/**
 * Per-kind handler resolved by the stream route when a task-notification
 * message arrives. Functional module shape, one handler file per kind under
 * `./kinds/`.
 */
export interface TaskNotificationKindHandler {
  kind: string
  /** Org-scoped load of the task's current state; null → unknown/foreign ref. */
  load(ref: string, organizationId: string): Promise<TaskSnapshot | null>
  isTerminal(task: TaskSnapshot): boolean
  summarize(task: TaskSnapshot): TaskNotificationSummary
}
