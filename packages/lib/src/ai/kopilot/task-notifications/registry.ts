// packages/lib/src/ai/kopilot/task-notifications/registry.ts

import { evalSuiteTaskNotificationHandler } from './kinds/eval-suite'
import type { TaskNotificationKindHandler } from './types'

/** Adding a consumer = one handler file under ./kinds/ + an entry here. */
const handlers: Record<string, TaskNotificationKindHandler> = {
  [evalSuiteTaskNotificationHandler.kind]: evalSuiteTaskNotificationHandler,
}

export function getTaskNotificationHandler(kind: string): TaskNotificationKindHandler | undefined {
  return handlers[kind]
}

export function listTaskNotificationKinds(): string[] {
  return Object.keys(handlers)
}
