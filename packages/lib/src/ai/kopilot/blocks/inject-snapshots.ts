// packages/lib/src/ai/kopilot/blocks/inject-snapshots.ts

import type {
  AgentToolDefinition,
  ToolOutputBlock,
  TurnSnapshots,
} from '../../agent-framework/types'
import { REFERENCE_BLOCK_TYPES, SNAPSHOT_INJECTABLE_TYPES } from './block-types'

/**
 * Post-process `submit_final_answer.content` so every `auxx:*` reference-block
 * fence carries a snapshot map for the ids inside it. The LLM only writes
 * ids; snapshots come from the turn's tool-output map so historical accuracy
 * survives record deletion on reload.
 *
 * Unknown ids (LLM hallucinated) stay in the fence without a snapshot entry;
 * the frontend renders those as "Record unavailable" placeholders.
 */
const FENCE_RE = /```auxx:([a-z-]+)\n([\s\S]*?)\n```/g

const USER_FACING_BLOCK_TYPES = new Set<string>(REFERENCE_BLOCK_TYPES)
const INJECTABLE_SET = new Set<string>(SNAPSHOT_INJECTABLE_TYPES)

export function injectSnapshotsIntoFinal(content: string, snapshots: TurnSnapshots): string {
  return content.replace(FENCE_RE, (match, type: string, body: string) => {
    if (!INJECTABLE_SET.has(type)) return match
    let data: Record<string, unknown>
    try {
      data = JSON.parse(body) as Record<string, unknown>
    } catch {
      return match
    }

    const patched = injectForType(type, data, snapshots)
    if (!patched) return match

    return `\`\`\`auxx:${type}\n${JSON.stringify(patched)}\n\`\`\``
  })
}

/**
 * Normalize an LLM-written recordId. Occasionally the model will prefix the
 * apiSlug or entity label, producing 3+ segments like `tickets:defId:instId`.
 * When the trailing 2 segments match an id in the turn snapshot map, strip the
 * prefix. Otherwise return as-is (the frontend renders "Record unavailable").
 */
function normalizeRecordId(id: string, records: Record<string, unknown>): string {
  const colonCount = (id.match(/:/g) ?? []).length
  if (colonCount === 1) return id
  if (colonCount < 2) return id
  const parts = id.split(':')
  for (let start = 1; start < parts.length - 1; start++) {
    const candidate = parts.slice(start).join(':')
    if (candidate in records) return candidate
  }
  return id
}

function injectForType(
  type: string,
  data: Record<string, unknown>,
  snapshots: TurnSnapshots
): Record<string, unknown> | null {
  switch (type) {
    case 'entity-card': {
      const raw = typeof data.recordId === 'string' ? data.recordId : null
      if (!raw) return null
      const recordId = normalizeRecordId(raw, snapshots.records)
      const snap = snapshots.records[recordId]
      const next: Record<string, unknown> = { ...data, recordId }
      if (snap) next.snapshot = snap
      return next
    }
    case 'entity-list': {
      const ids = Array.isArray(data.recordIds)
        ? (data.recordIds as unknown[])
            .filter((id): id is string => typeof id === 'string')
            .map((id) => normalizeRecordId(id, snapshots.records))
        : []
      const snap: Record<string, unknown> = {}
      for (const id of ids) {
        const entry = snapshots.records[id]
        if (entry) snap[id] = entry
      }
      const next: Record<string, unknown> = { ...data, recordIds: ids }
      if (Object.keys(snap).length > 0) next.snapshot = snap
      return next
    }
    case 'thread-list': {
      const ids = Array.isArray(data.threadIds)
        ? (data.threadIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : []
      const snap: Record<string, unknown> = {}
      for (const id of ids) {
        const entry = snapshots.threads[id]
        if (entry) snap[id] = entry
      }
      return Object.keys(snap).length > 0 ? { ...data, snapshot: snap } : data
    }
    case 'task-list': {
      const ids = Array.isArray(data.taskIds)
        ? (data.taskIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : []
      const snap: Record<string, unknown> = {}
      for (const id of ids) {
        const entry = snapshots.tasks[id]
        if (entry) snap[id] = entry
      }
      return Object.keys(snap).length > 0 ? { ...data, snapshot: snap } : data
    }
    default:
      return null
  }
}

/**
 * Count `auxx:*` reference-block fences inside the given content. Used by the
 * query loop to decide whether to auto-emit a fallback block when the LLM
 * forgets.
 */
export function countReferenceBlockFences(content: string): number {
  let n = 0
  FENCE_RE.lastIndex = 0
  for (const match of content.matchAll(FENCE_RE)) {
    if (USER_FACING_BLOCK_TYPES.has(match[1]!)) n++
  }
  return n
}

/**
 * Build a default reference-block fence when the LLM forgets to embed one.
 * Dispatches on the last read-tool's declared `outputBlock` (read from the
 * tool definition). Falls through to whichever snapshot map is non-empty
 * when the hint is missing.
 */
export function buildFallbackFence(
  snapshots: TurnSnapshots,
  lastTool: AgentToolDefinition | undefined
): string | null {
  const block = lastTool?.outputBlock
  if (block) {
    const fence = buildFenceForBlock(block, snapshots)
    if (fence) return fence
  }

  // Fall through to whichever map is non-empty
  return (
    buildFenceForBlock('entity-list', snapshots) ??
    buildFenceForBlock('thread-list', snapshots) ??
    buildFenceForBlock('task-list', snapshots)
  )
}

function buildFenceForBlock(block: ToolOutputBlock, snapshots: TurnSnapshots): string | null {
  switch (block) {
    case 'entity-card':
    case 'entity-list':
      // Opt-in: the LLM must emit `auxx:entity-card` (single) or
      // `auxx:entity-list` (multiple) explicitly with the recordIds it
      // actually wants surfaced. The shared `snapshots.records` pool
      // accumulates across every record-returning tool in the turn, so
      // auto-emitting from it re-surfaces tangentially-relevant matches
      // the LLM filtered out in prose.
      return null
    case 'thread-list': {
      const ids = Object.keys(snapshots.threads)
      if (ids.length === 0) return null
      const snap: Record<string, unknown> = {}
      for (const id of ids) snap[id] = snapshots.threads[id]
      return `\`\`\`auxx:thread-list\n${JSON.stringify({ threadIds: ids, snapshot: snap })}\n\`\`\``
    }
    case 'task-list': {
      const ids = Object.keys(snapshots.tasks)
      if (ids.length === 0) return null
      const snap: Record<string, unknown> = {}
      for (const id of ids) snap[id] = snapshots.tasks[id]
      return `\`\`\`auxx:task-list\n${JSON.stringify({ taskIds: ids, snapshot: snap })}\n\`\`\``
    }
  }
}
