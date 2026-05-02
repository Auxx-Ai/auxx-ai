// packages/lib/src/ai/kopilot/blocks/inject-snapshots.ts

import type { TurnSnapshots } from '../../agent-framework/types'
import { SNAPSHOT_INJECTABLE_TYPES } from './block-types'

/**
 * Post-process the responder's final content so every `auxx:*` reference-block
 * fence carries a snapshot map for the ids inside it. The LLM only writes
 * ids; snapshots come from the turn's tool-output map so historical accuracy
 * survives record deletion on reload.
 *
 * Unknown ids (LLM hallucinated) stay in the fence without a snapshot entry;
 * the frontend renders those as "Record unavailable" placeholders.
 */
const FENCE_RE = /```auxx:([a-z-]+)\n([\s\S]*?)\n```/g

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
    case 'draft-list': {
      const ids = Array.isArray(data.draftIds)
        ? (data.draftIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : []
      const snap: Record<string, unknown> = {}
      for (const id of ids) {
        const entry = snapshots.drafts[id]
        if (entry) snap[id] = entry
      }
      return Object.keys(snap).length > 0 ? { ...data, snapshot: snap } : data
    }
    default:
      return null
  }
}
