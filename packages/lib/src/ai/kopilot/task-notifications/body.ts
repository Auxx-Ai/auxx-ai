// packages/lib/src/ai/kopilot/task-notifications/body.ts

import type { TaskNotificationSummary } from './types'

export interface TaskNotificationBodyInput extends TaskNotificationSummary {
  kind: string
  ref: string
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * The model-facing message body for a completed async task. One builder so
 * every kind emits the same shape; content comes from the kind handler's
 * `summarize()` (DB truth), never from the client.
 */
export function buildTaskNotificationBody(input: TaskNotificationBodyInput): string {
  return [
    '<task-notification>',
    `  <kind>${escapeXml(input.kind)}</kind>`,
    `  <ref>${escapeXml(input.ref)}</ref>`,
    `  <status>${escapeXml(input.status)}</status>`,
    `  <summary>${escapeXml(input.summary)}</summary>`,
    `  <instruction>${escapeXml(input.instruction)}</instruction>`,
    '</task-notification>',
  ].join('\n')
}
