// apps/web/src/components/kopilot/utils/task-notifications.ts
//
// Pure helpers for the task-notification client loop (registration scan,
// history dedupe, drain gate). Kept free of store/React imports so they are
// trivially unit-testable. See plans/kopilot/task-notifications/plan.md §D.

import type { KopilotMessage } from '../stores/kopilot-store'

export const TASK_NOTIFICATION_ORIGIN = 'task-notification'

export interface TaskRef {
  kind: string
  ref: string
}

/** True when `message` is the (server-stamped) notification for this task. */
export function isTaskNotificationMessage(message: KopilotMessage, task?: TaskRef): boolean {
  if (message.role !== 'user') return false
  if (message.metadata?.origin !== TASK_NOTIFICATION_ORIGIN) return false
  if (!task) return true
  return message.metadata.kind === task.kind && message.metadata.ref === task.ref
}

/** Every `taskNotification` ref carried by tool outputs in these messages. */
export function extractTaskRefs(messages: KopilotMessage[]): TaskRef[] {
  const refs: TaskRef[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'tool_call' || part.status !== 'completed') continue
      const ref = (part.output as { taskNotification?: { kind?: string; ref?: string } } | null)
        ?.taskNotification
      if (!ref?.kind || !ref.ref) continue
      const key = `${ref.kind}:${ref.ref}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({ kind: ref.kind, ref: ref.ref })
    }
  }
  return refs
}

/**
 * Replay-on-load + live registration in one scan: refs whose notification has
 * not been delivered yet. Whether the task is still running is the watcher's
 * job (status poll) — terminal tasks simply mark terminal on the first tick
 * and drain immediately.
 */
export function findUnnotifiedTaskRefs(messages: KopilotMessage[]): TaskRef[] {
  return extractTaskRefs(messages).filter(
    (task) => !messages.some((m) => isTaskNotificationMessage(m, task))
  )
}

/** Any approval card still waiting on the human? Counts as an active turn. */
export function hasPendingApproval(messages: KopilotMessage[]): boolean {
  return messages.some((m) => m.approval?.status === 'pending')
}

/**
 * The drain gate: notifications are a queue, never an interrupt. User input
 * always outranks them — anything in flight or awaiting a human wins.
 */
export function canDrainNotification(input: {
  isStreaming: boolean
  pendingRequest: unknown
  messages: KopilotMessage[]
}): boolean {
  if (input.isStreaming) return false
  if (input.pendingRequest) return false
  if (hasPendingApproval(input.messages)) return false
  return true
}
