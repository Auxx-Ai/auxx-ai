// packages/lib/src/ai/kopilot/blocks/snapshot-walker.ts

import type {
  EntitySnapshot,
  TaskSnapshot,
  ThreadSnapshot,
  TurnSnapshots,
} from '../../agent-framework/types'

/**
 * Generic snapshot walker. Recurses into every tool result and harvests
 * record / thread / task ids based on item shape — no `outputBlock` hint
 * required. The three shape probes are mutually exclusive enough that
 * running them all on every output is cheap and safe.
 *
 * Recognized container shapes (max recursion depth = WALKER_MAX_DEPTH):
 *   - top-level arrays
 *   - `{ items: [...] }`
 *   - `{ threads: [...] }` / `{ thread: {...} }`
 *   - `{ tasks: [...] }`
 *   - `{ results: [...] }`
 *
 * Recognized item shapes:
 *   - entity: string `recordId` of format `<defId>:<instId>`,
 *     plus optional `displayName`, `secondaryInfo`
 *   - thread: string `id` or `threadId`, plus `subject`, `lastMessageAt`,
 *     optional `sender`, `isUnread`
 *   - task: string `id` or `taskId`, plus `title`, `deadline`, `completedAt`
 */

const WALKER_MAX_DEPTH = 3
const CONTAINER_KEYS = ['items', 'threads', 'thread', 'tasks', 'results'] as const

export function createEmptyTurnSnapshots(): TurnSnapshots {
  return { records: {}, threads: {}, tasks: {}, docs: {} }
}

export function runSnapshotWalker(output: unknown, target: TurnSnapshots): void {
  walk(output, target, 0)
}

function walk(node: unknown, target: TurnSnapshots, depth: number): void {
  if (depth > WALKER_MAX_DEPTH || node == null) return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, target, depth + 1)
    return
  }
  const obj = asObject(node)
  if (!obj) return
  // Probes are disjoint by shape — entity needs `recordId`, thread/task explicitly
  // exclude `recordId`-bearing items in their detectors.
  if (isEntityLike(obj)) addEntitySnapshot(target, obj)
  else if (isThreadLike(obj)) addThreadSnapshot(target, obj)
  else if (isTaskLike(obj)) addTaskSnapshot(target, obj)
  for (const key of CONTAINER_KEYS) {
    if (key in obj) walk(obj[key], target, depth + 1)
  }
}

// ===== Item shape detectors =====

const RECORD_ID_RE = /^[^:]+:[^:]+$/

function isEntityLike(obj: Record<string, unknown>): boolean {
  const recordId = asString(obj.recordId)
  return typeof recordId === 'string' && RECORD_ID_RE.test(recordId)
}

function isThreadLike(obj: Record<string, unknown>): boolean {
  const id = asString(obj.threadId) ?? asString(obj.id)
  if (!id) return false
  // Distinguish from entity-like items: threads don't have a colon-formatted recordId
  if ('recordId' in obj && typeof obj.recordId === 'string') return false
  return 'subject' in obj || 'lastMessageAt' in obj || 'sender' in obj
}

function isTaskLike(obj: Record<string, unknown>): boolean {
  const id = asString(obj.taskId) ?? asString(obj.id)
  if (!id) return false
  if ('recordId' in obj && typeof obj.recordId === 'string') return false
  return 'title' in obj && (typeof obj.title === 'string' || typeof obj.title === 'undefined')
}

// ===== Snapshot emitters =====

function addEntitySnapshot(target: TurnSnapshots, item: Record<string, unknown>): void {
  const recordId = asString(item.recordId)
  if (!recordId) return
  const parts = recordId.split(':')
  if (parts.length < 2) return
  const displayName = asString(item.displayName)
  // Skip snapshotting when the tool didn't supply a name — the frontend will
  // hydrate via useRecord. Falling back to the recordId here poisons the card
  // with the raw id until hydration resolves.
  if (!displayName) return
  const entityDefinitionId = parts[0]!
  const summary = asString(item.secondaryInfo)

  const snap: EntitySnapshot = { recordId, entityDefinitionId, displayName }
  if (summary) snap.summary = summary
  target.records[recordId] = snap
}

function addThreadSnapshot(target: TurnSnapshots, item: Record<string, unknown>): void {
  const threadId = asString(item.id) ?? asString(item.threadId)
  if (!threadId) return
  const snap: ThreadSnapshot = {
    threadId,
    subject: asString(item.subject) ?? null,
    lastMessageAt: asDateString(item.lastMessageAt),
  }
  const sender = asString(item.sender)
  if (sender) snap.sender = sender
  if (typeof item.isUnread === 'boolean') snap.isUnread = item.isUnread
  target.threads[threadId] = snap
}

function addTaskSnapshot(target: TurnSnapshots, item: Record<string, unknown>): void {
  const taskId = asString(item.id) ?? asString(item.taskId)
  if (!taskId) return
  const snap: TaskSnapshot = {
    taskId,
    title: asString(item.title) ?? taskId,
    deadline: asDateString(item.deadline),
    completedAt: asDateString(item.completedAt),
  }
  target.tasks[taskId] = snap
}

// ===== Low-level type guards =====

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asDateString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return null
}
