// packages/lib/src/ai/kopilot/blocks/extract-link-snapshots.ts

import type { LinkSnapshot, TurnSnapshots } from '../../agent-framework/types'

/**
 * Walk the final assistant content for `[label](auxx://...)` markdown links and
 * resolve each href against the turn's snapshot maps. Returns the per-message
 * lookup table the frontend reads to render hover-card chips. Keyed by the full
 * `auxx://...` href.
 *
 * Hrefs that don't resolve are silently skipped — the chip falls back to its
 * label-only rendering.
 */
const LINK_RE = /\[[^\]]+\]\((auxx:\/\/[^\s)]+)\)/g

export function extractLinkSnapshots(
  content: string,
  snapshots: TurnSnapshots
): Record<string, LinkSnapshot> {
  const result: Record<string, LinkSnapshot> = {}
  for (const match of content.matchAll(LINK_RE)) {
    const href = match[1]!
    if (result[href]) continue
    const snapshot = resolveHref(href, snapshots)
    if (snapshot) result[href] = snapshot
  }
  return result
}

function resolveHref(href: string, snapshots: TurnSnapshots): LinkSnapshot | undefined {
  const rest = href.slice('auxx://'.length)
  const slashIdx = rest.indexOf('/')
  if (slashIdx === -1) return undefined
  const kind = rest.slice(0, slashIdx)
  const id = rest.slice(slashIdx + 1)
  if (!id) return undefined

  switch (kind) {
    case 'record':
      return snapshots.records[id]
    case 'thread':
      return snapshots.threads[id]
    case 'task':
      return snapshots.tasks[id]
    case 'doc': {
      const slug = decodeURIComponent(id)
      return snapshots.docs[slug] ?? snapshots.docs[id]
    }
    default:
      return undefined
  }
}
