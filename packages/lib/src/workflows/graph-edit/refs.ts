// packages/lib/src/workflows/graph-edit/refs.ts

/**
 * Node reference resolution (`03-graph-edit-service.md` §2) — pure, browser-safe.
 *
 * Tools accept a `ref` that is a node **title** or a node id. Titles are what
 * the model sees and what the user talks about; ids are nanoids it would have
 * to copy correctly every time. Resolution rules:
 *
 * - Exact title match, case-insensitive → that node.
 * - Multiple title matches → error listing candidates with ids. Never guess —
 *   the canvas does not enforce title uniqueness, so ambiguity is the common
 *   error path, not an edge case.
 * - No title match → exact id match.
 * - Otherwise → actionable NotFound error naming the closest candidates.
 */

import { err, ok, type Result } from 'neverthrow'
import { type AuxxError, BadRequestError, NotFoundError } from '../../errors'
import type { NodeMeta, ResolvedNodeRef } from './types'

/** A node's display title (`data.title`), or '' when unset. */
export function nodeTitle(node: NodeMeta): string {
  const title = node.data?.title
  return typeof title === 'string' ? title : ''
}

/** `"Title" (id)` — the candidate format every ambiguity/not-found error uses. */
export function describeNode(node: NodeMeta): string {
  const title = nodeTitle(node)
  return title ? `"${title}" (${node.id})` : `(${node.id})`
}

/**
 * Whether a string is shaped like a generated node id (nanoid / cuid2 — 16+
 * url-safe chars, no dots or spaces). Only used to phrase errors; resolution
 * itself always tries an exact id match regardless of shape.
 */
export function isIdShaped(ref: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(ref)
}

/** Levenshtein edit distance — small inputs only (variable segments, titles). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dist: number[] = Array.from({ length: cols }, (_, j) => j)
  for (let i = 1; i < rows; i++) {
    let prevDiagonal = dist[0]!
    dist[0] = i
    for (let j = 1; j < cols; j++) {
      const current = dist[j]!
      dist[j] = Math.min(
        current + 1,
        dist[j - 1]! + 1,
        prevDiagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      prevDiagonal = current
    }
  }
  return dist[cols - 1]!
}

/**
 * The candidates closest to `input` by case-insensitive edit distance, nearest
 * first. Only near misses qualify (distance ≤ max(2, ⌊len/3⌋)) — a "did you
 * mean" that suggests something unrelated is worse than none.
 */
export function closestMatches(input: string, candidates: string[], limit = 3): string[] {
  const needle = input.toLowerCase()
  const maxDistance = Math.max(2, Math.floor(needle.length / 3))
  return candidates
    .map((candidate) => ({ candidate, distance: editDistance(needle, candidate.toLowerCase()) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ candidate }) => candidate)
}

/** All nodes whose title equals `ref` case-insensitively. */
function titleMatches(nodes: NodeMeta[], ref: string): NodeMeta[] {
  const needle = ref.toLowerCase()
  return nodes.filter((n) => {
    const title = nodeTitle(n)
    return title !== '' && title.toLowerCase() === needle
  })
}

function ambiguityError(ref: string, matches: NodeMeta[]): AuxxError {
  return new BadRequestError(
    `Node reference "${ref}" is ambiguous — ${matches.length} nodes share this title: ` +
      `${matches.map(describeNode).join(', ')}. Use the node id instead.`
  )
}

function notFoundError(nodes: NodeMeta[], ref: string): AuxxError {
  const titles = nodes.map(nodeTitle).filter((t) => t !== '')
  const near = closestMatches(ref, titles)
  const candidates = (near.length > 0 ? near : titles.slice(0, 10)).map((title) => {
    const match = nodes.find((n) => nodeTitle(n) === title)
    return match ? describeNode(match) : `"${title}"`
  })
  const hint =
    candidates.length > 0
      ? near.length > 0
        ? ` Did you mean ${candidates.join(' or ')}?`
        : ` Available nodes: ${candidates.join(', ')}.`
      : ' The graph has no nodes.'
  const idNote = isIdShaped(ref) ? ' (No node has this id either.)' : ''
  return new NotFoundError(`No node matches "${ref}".${idNote}${hint}`)
}

/**
 * Resolve a node reference (title or id) to a node. Title match wins; an
 * ambiguous title is an error listing every candidate with its id — never a
 * guess.
 */
export function resolveNodeRef(nodes: NodeMeta[], ref: string): Result<ResolvedNodeRef, AuxxError> {
  const trimmed = ref.trim()
  if (!trimmed) return err(new BadRequestError('Node reference is empty'))

  const byTitle = titleMatches(nodes, trimmed)
  if (byTitle.length === 1) return ok({ node: byTitle[0]!, matchedBy: 'title' })
  if (byTitle.length > 1) return err(ambiguityError(trimmed, byTitle))

  const byId = nodes.find((n) => n.id === trimmed)
  if (byId) return ok({ node: byId, matchedBy: 'id' })

  return err(notFoundError(nodes, trimmed))
}

/** A node-ref prefix match inside a variable path. */
export interface NodeRefPrefixMatch extends ResolvedNodeRef {
  /** The path remainder after the matched ref, leading `.` stripped (`''` for a bare ref). */
  rest: string
}

/** Boundary offsets a node ref may end at: end of string, each `.`, the first `[`. */
function prefixBoundaries(path: string): number[] {
  const boundaries = new Set<number>([path.length])
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '.') boundaries.add(i)
    if (path[i] === '[') {
      boundaries.add(i)
      break // a `[` always ends the ref — titles never contain brackets in refs
    }
  }
  return Array.from(boundaries).sort((a, b) => b - a)
}

/**
 * Match the node reference at the head of a variable path — the parser behind
 * `{{Find Contact.email}}` → node + `email`.
 *
 * Titles may contain `.`, so the first segment alone can't identify the ref.
 * Every prefix ending at a `.` (or the first `[`, or end-of-string) is tried
 * longest-first: the longest case-insensitive title match wins, an ambiguous
 * title at that boundary errors, and with no title match anywhere the first
 * segment is tried as an exact node id. `ok(null)` means "not a node ref at
 * all" (prose, `env.X`, `sys.Y`) — the caller decides whether that's an error.
 */
export function matchNodeRefPrefix(
  nodes: NodeMeta[],
  path: string
): Result<NodeRefPrefixMatch | null, AuxxError> {
  const trimmed = path.trim()
  if (!trimmed) return ok(null)

  for (const boundary of prefixBoundaries(trimmed)) {
    const candidate = trimmed.slice(0, boundary)
    // Prose guard: a matched title followed by `.` and whitespace (or a bare
    // trailing `.`) is a sentence, not a ref — skip the boundary so "Find
    // Contact. Thanks." in a gated bare string is never rewritten.
    if (boundary < trimmed.length) {
      const after = trimmed.slice(boundary + (trimmed[boundary] === '.' ? 1 : 0))
      if (!after || /^\s/.test(after)) continue
    }
    const matches = titleMatches(nodes, candidate)
    if (matches.length > 1) return err(ambiguityError(candidate, matches))
    if (matches.length === 1) {
      const rest = trimmed.slice(boundary).replace(/^\./, '')
      return ok({ node: matches[0]!, matchedBy: 'title', rest })
    }
  }

  const firstSegmentEnd = Math.min(
    ...[trimmed.indexOf('.'), trimmed.indexOf('[')].filter((i) => i >= 0),
    trimmed.length
  )
  const firstSegment = trimmed.slice(0, firstSegmentEnd)
  const byId = nodes.find((n) => n.id === firstSegment)
  if (byId) {
    const rest = trimmed.slice(firstSegmentEnd).replace(/^\./, '')
    return ok({ node: byId, matchedBy: 'id', rest })
  }

  return ok(null)
}

/**
 * Render a node id as the friendly ref the model should see: the title when it
 * is unique in the graph (case-insensitively), the raw id otherwise — a
 * duplicated title would round-trip into an ambiguity error, so the id is the
 * only honest rendering. Unknown ids pass through unchanged.
 */
export function formatNodeRef(nodes: NodeMeta[], nodeId: string): string {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return nodeId
  const title = nodeTitle(node)
  if (!title) return nodeId
  return titleMatches(nodes, title).length === 1 ? title : nodeId
}
