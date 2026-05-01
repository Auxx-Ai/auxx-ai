// packages/lib/src/ai/kopilot/blocks/snapshot-walker.ts

import type {
  EntitySnapshot,
  TaskSnapshot,
  ThreadSnapshot,
  ToolOutputBlock,
  TurnSnapshots,
} from '../../agent-framework/types'

/**
 * Generic snapshot walker. Drives snapshot extraction off the tool's
 * declared `outputBlock` rather than per-tool code.
 *
 * For each `outputBlock` kind, a probe recurses into the tool's `output`,
 * finds items that structurally match the expected id-bearing shape, and
 * calls the matching `addX` helper to populate the turn's snapshot map.
 *
 * Tools whose output shape is unusual can either (a) omit `outputBlock`
 * to skip the walker entirely or (b) emit items in one of the known
 * shapes listed below.
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

export function runSnapshotWalker(
  outputBlock: ToolOutputBlock | undefined,
  output: unknown,
  target: TurnSnapshots
): void {
  if (!outputBlock) return
  const probe = PROBES[outputBlock]
  probe(output, target)
}

// ===== Shape probes =====

const PROBES: Record<ToolOutputBlock, (output: unknown, target: TurnSnapshots) => void> = {
  'entity-card': (output, target) => walkForEntities(output, target, 0),
  'entity-list': (output, target) => walkForEntities(output, target, 0),
  'thread-list': (output, target) => walkForThreads(output, target, 0),
  'task-list': (output, target) => walkForTasks(output, target, 0),
}

function walkForEntities(node: unknown, target: TurnSnapshots, depth: number): void {
  if (depth > WALKER_MAX_DEPTH || node == null) return
  if (Array.isArray(node)) {
    for (const item of node) walkForEntities(item, target, depth + 1)
    return
  }
  const obj = asObject(node)
  if (!obj) return
  if (isEntityLike(obj)) addEntitySnapshot(target, obj)
  for (const key of CONTAINER_KEYS) {
    if (key in obj) walkForEntities(obj[key], target, depth + 1)
  }
}

function walkForThreads(node: unknown, target: TurnSnapshots, depth: number): void {
  if (depth > WALKER_MAX_DEPTH || node == null) return
  if (Array.isArray(node)) {
    for (const item of node) walkForThreads(item, target, depth + 1)
    return
  }
  const obj = asObject(node)
  if (!obj) return
  if (isThreadLike(obj)) addThreadSnapshot(target, obj)
  for (const key of CONTAINER_KEYS) {
    if (key in obj) walkForThreads(obj[key], target, depth + 1)
  }
}

function walkForTasks(node: unknown, target: TurnSnapshots, depth: number): void {
  if (depth > WALKER_MAX_DEPTH || node == null) return
  if (Array.isArray(node)) {
    for (const item of node) walkForTasks(item, target, depth + 1)
    return
  }
  const obj = asObject(node)
  if (!obj) return
  if (isTaskLike(obj)) addTaskSnapshot(target, obj)
  for (const key of CONTAINER_KEYS) {
    if (key in obj) walkForTasks(obj[key], target, depth + 1)
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
