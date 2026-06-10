// apps/web/src/app/api/kopilot/stream/task-notification.ts
//
// Server-side validation + body rewrite for task-notification messages
// (plans/kopilot/task-notifications/plan.md §C). The client is only a trigger:
// the message body is rebuilt here from DB truth via the kind handler, and a
// session that already carries a notification for the same (kind, ref) no-ops.

import {
  buildTaskNotificationBody,
  getTaskNotificationHandler,
  type TaskNotificationKindHandler,
} from '@auxx/lib/ai/kopilot/task-notifications'
import { getSessionById } from '@auxx/services'

export const TASK_NOTIFICATION_ORIGIN = 'task-notification'

export interface TaskNotificationMetadata {
  origin: typeof TASK_NOTIFICATION_ORIGIN
  kind: string
  ref: string
  [key: string]: unknown
}

export type TaskNotificationResolution =
  | { ok: true; deduped: false; message: string; metadata: TaskNotificationMetadata }
  | { ok: true; deduped: true }
  | { ok: false; status: 400 | 404 | 422 | 500; error: string }

interface ResolveDeps {
  getHandler: (kind: string) => TaskNotificationKindHandler | undefined
  loadSessionMessages: (input: {
    sessionId: string
    organizationId: string
  }) => Promise<Record<string, unknown>[] | null>
}

const defaultDeps: ResolveDeps = {
  getHandler: getTaskNotificationHandler,
  loadSessionMessages: async ({ sessionId, organizationId }) => {
    const result = await getSessionById({ sessionId, organizationId })
    if (result.isErr()) return null
    return (result.value.messages ?? []) as Record<string, unknown>[]
  },
}

/** True when `message` is a persisted notification for the same task. */
export function isNotificationForTask(
  message: Record<string, unknown>,
  task: { kind: string; ref: string }
): boolean {
  const metadata = message.metadata as Record<string, unknown> | undefined
  if (!metadata) return false
  return (
    metadata.origin === TASK_NOTIFICATION_ORIGIN &&
    metadata.kind === task.kind &&
    metadata.ref === task.ref
  )
}

export async function resolveTaskNotification(
  input: {
    sessionId?: string
    task?: { kind?: string; ref?: string }
    organizationId: string
  },
  deps: ResolveDeps = defaultDeps
): Promise<TaskNotificationResolution> {
  const { sessionId, task, organizationId } = input

  // Notifications continue an existing conversation; they never create sessions.
  if (!sessionId) {
    return { ok: false, status: 400, error: 'Task notifications require a sessionId' }
  }
  if (!task?.kind || !task.ref) {
    return { ok: false, status: 400, error: 'Task notifications require task.kind and task.ref' }
  }
  const { kind, ref } = task

  const handler = deps.getHandler(kind)
  if (!handler) {
    return { ok: false, status: 400, error: `Unknown task-notification kind: ${kind}` }
  }

  let snapshot: Record<string, unknown> | null
  try {
    snapshot = await handler.load(ref, organizationId)
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to load task',
    }
  }
  if (!snapshot) {
    return { ok: false, status: 404, error: `Task not found: ${kind}/${ref}` }
  }
  // Client retries on its next status tick once the task is actually terminal.
  if (!handler.isTerminal(snapshot)) {
    return { ok: false, status: 422, error: `Task is not terminal yet: ${kind}/${ref}` }
  }

  const messages = await deps.loadSessionMessages({ sessionId, organizationId })
  if (!messages) {
    return { ok: false, status: 404, error: 'Session not found' }
  }
  // Authoritative idempotency check — one notification per task per session.
  if (messages.some((m) => isNotificationForTask(m, { kind, ref }))) {
    return { ok: true, deduped: true }
  }

  const summary = handler.summarize(snapshot)
  return {
    ok: true,
    deduped: false,
    message: buildTaskNotificationBody({ kind, ref, ...summary }),
    metadata: { origin: TASK_NOTIFICATION_ORIGIN, kind, ref },
  }
}
