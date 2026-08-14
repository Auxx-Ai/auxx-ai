// packages/lib/src/workflows/graph-edit/normalize/friendly-refs.ts

/**
 * Friendly ↔ persisted variable-reference rewriting (`03-graph-edit-service.md`
 * §3, rows 1 and 3) — pure, browser-safe.
 *
 * Friendly → persisted: `{{Find Contact.email}}` → `{{<nodeId>.email}}`, and
 * the resource segment one level deeper: `{{Find Tickets.ticket.subject}}` →
 * `{{<nodeId>.<entityDefId>.subject}}` — the same rewrite
 * `TemplateGraphTransformer.cloneGraph` does for template node ids and
 * `resolveEntityRefsInGraph` does for `@entity:` tokens, applied to titles and
 * resource slugs so a model never types a raw id.
 *
 * Persisted → friendly: the exact reverse, so everything returned to a caller
 * renders refs as `{{Title.path}}` (and resource slugs) — a model that has
 * never seen a raw id cannot invent one.
 *
 * The friendly direction deliberately does NOT reuse
 * `rewriteVariableRefs` (`../../variable-ref-rewriter`): that walker applies
 * one strictness to `{{…}}` spans and bare strings alike, while friendly input
 * needs two regimes — spans are always refs (an unresolvable one is an ERROR,
 * never a silent drop), bare strings are only *possibly* refs (prose that
 * happens to start like a title must pass through untouched). The reverse
 * direction has no such split and reuses the shared walker via the same
 * traversal contract. Both directions share `firstPathSegment` and the
 * `VARIABLE_PATTERN` span grammar rather than re-deriving them.
 */

import { VARIABLE_PATTERN } from '../../../workflow-engine/catalog/variable-inference'
import { firstPathSegment, rewriteVariableRefs } from '../../variable-ref-rewriter'
import { formatNodeRef, matchNodeRefPrefix, nodeTitle } from '../refs'
import type { Issue, NodeMeta } from '../types'

/**
 * Per-org resource alias lookup for the resource path segment (tier B/C only —
 * tier-A slugs ARE their canonical id and never appear here). Built server-side
 * by `buildResourceAliasIndex` (`resource-refs.ts`); consumed by the pure
 * rewriters so they stay browser-safe.
 */
export interface ResourceAliasIndex {
  /** lowercased alias (id, entityType, apiSlug, label, plural) → canonical resource id */
  aliasToId: Map<string, string>
  /** canonical resource id → the slug rendered back to the model (entityType ?? apiSlug) */
  idToSlug: Map<string, string>
}

/** First-segment prefixes that are never node refs. */
const RESERVED_PREFIXES = new Set(['env', 'sys'])

/** Result of a friendly-ref rewrite pass. */
export interface FriendlyRefsResult<T> {
  data: T
  issues: Issue[]
}

/** The canonical resource id a node's `resourceType` config resolves to, if tier B/C. */
function canonicalResourceIdFor(
  node: NodeMeta,
  aliases: ResourceAliasIndex | undefined
): string | undefined {
  if (!aliases) return undefined
  const resourceType = node.data?.resourceType
  if (typeof resourceType !== 'string' || !resourceType) return undefined
  if (aliases.idToSlug.has(resourceType)) return resourceType
  return aliases.aliasToId.get(resourceType.toLowerCase())
}

/** Join a resolved head onto a path remainder (`''`, `.x…` via caller, or `[0]…`). */
function joinHead(head: string, rest: string): string {
  if (!rest) return head
  return rest.startsWith('[') ? `${head}${rest}` : `${head}.${rest}`
}

/**
 * Rewrite the resource segment at the head of `rest` to `canonicalId` when it
 * is an alias of that same resource (never a guess across resources).
 */
function aliasResourceSegment(
  rest: string,
  canonicalId: string | undefined,
  aliases: ResourceAliasIndex | undefined
): string {
  if (!rest || !canonicalId || !aliases) return rest
  const segment = firstPathSegment(rest)
  if (!segment || segment === canonicalId) return rest
  if (aliases.aliasToId.get(segment.toLowerCase()) !== canonicalId) return rest
  return canonicalId + rest.slice(segment.length)
}

interface WalkOptions {
  /** Rewrite one `{{…}}` span's inner path. Unresolvable refs report an issue. */
  mapSpanPath: (path: string) => string
  /** Rewrite one bare string that *may* be a ref (already gated). */
  mapBarePath: (path: string) => string
  /** Gate for bare strings: first path segment must be in this set. */
  bareGate: Set<string>
}

/** Depth-first walk over node data, string values only, keys untouched. */
function walk(value: unknown, options: WalkOptions): unknown {
  if (typeof value === 'string') {
    if (value.includes('{{')) {
      return value.replace(VARIABLE_PATTERN, (_full, inner: string) => {
        return `{{${options.mapSpanPath(inner)}}}`
      })
    }
    if (options.bareGate.has(firstPathSegment(value))) {
      return options.mapBarePath(value)
    }
    return value
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = walk(value[i], options)
    return value
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      record[key] = walk(record[key], options)
    }
    return record
  }
  return value
}

/**
 * Friendly → persisted: rewrite every `{{Title.path}}` span and every gated
 * bare title/id reference in `data` to `{{<nodeId>.path}}`, aliasing the
 * resource path segment to the source node's canonical resource id where
 * applicable. Returns a deep clone; `data` is never mutated.
 *
 * Every span whose head resolves to nothing — and every ambiguous title —
 * comes back as an ERROR issue naming candidates; the value itself is left
 * verbatim so the caller can refuse to persist. Bare strings that fail to
 * resolve stay untouched *without* an issue (they may be prose); the
 * post-mutation reference check (`ref-check.ts`) is the net under those.
 */
export function normalizeFriendlyRefs<T>(
  data: T,
  params: { nodes: NodeMeta[]; resourceAliases?: ResourceAliasIndex }
): FriendlyRefsResult<T> {
  const { nodes, resourceAliases } = params
  const issues: Issue[] = []

  const bareGate = new Set<string>()
  for (const node of nodes) {
    bareGate.add(node.id)
    const title = nodeTitle(node)
    if (title) bareGate.add(firstPathSegment(title))
  }

  const mapPath = (path: string, strict: boolean): string => {
    const trimmed = path.trim()
    if (!trimmed || RESERVED_PREFIXES.has(firstPathSegment(trimmed))) return path

    const match = matchNodeRefPrefix(nodes, trimmed)
    if (match.isErr()) {
      issues.push({ severity: 'error', ref: trimmed, message: match.error.message })
      return path
    }
    if (match.value === null) {
      if (strict) {
        // Head matches no title and no id — try resolveNodeRef purely for its
        // actionable candidate list (it cannot succeed where the prefix
        // matcher found nothing at any boundary).
        const titles = nodes.map(nodeTitle).filter(Boolean)
        issues.push({
          severity: 'error',
          ref: trimmed,
          message:
            `Unknown node reference in "{{${trimmed}}}" — no node title or id matches its start.` +
            (titles.length > 0
              ? ` Available nodes: ${titles.map((t) => `"${t}"`).join(', ')}.`
              : ''),
        })
      }
      return path
    }

    const { node, rest } = match.value
    const aliasedRest = aliasResourceSegment(
      rest,
      canonicalResourceIdFor(node, resourceAliases),
      resourceAliases
    )
    return joinHead(node.id, aliasedRest)
  }

  const cloned = structuredClone(data)
  const result = walk(cloned, {
    mapSpanPath: (path) => mapPath(path, true),
    mapBarePath: (path) => mapPath(path, false),
    bareGate,
  }) as T
  return { data: result, issues }
}

/**
 * Persisted → friendly: render every `{{<nodeId>.path}}` span and bare id ref
 * as `{{Title.path}}` (title only when unique — a duplicated title keeps the
 * id, the only rendering that round-trips), and the canonical resource segment
 * back to its slug. Returns a deep clone; infallible — unknown ids pass
 * through unchanged.
 *
 * Reuses the shared `rewriteVariableRefs` walker: in this direction spans and
 * bare strings need the same treatment (an id head either resolves or is left
 * alone), which is exactly that walker's contract.
 */
export function renderPersistedRefs<T>(
  data: T,
  params: { nodes: NodeMeta[]; resourceAliases?: ResourceAliasIndex }
): T {
  const { nodes, resourceAliases } = params
  const nodeIds = new Set(nodes.map((n) => n.id))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const mapPath = (path: string): string => {
    const trimmed = path.trim()
    const head = firstPathSegment(trimmed)
    const node = nodeById.get(head)
    if (!node) return path

    let rest = trimmed.slice(head.length).replace(/^\./, '')
    const canonicalId = canonicalResourceIdFor(node, resourceAliases)
    if (rest && canonicalId && resourceAliases) {
      const segment = firstPathSegment(rest)
      if (segment === canonicalId) {
        const slug = resourceAliases.idToSlug.get(canonicalId)
        if (slug) rest = slug + rest.slice(segment.length)
      }
    }
    return joinHead(formatNodeRef(nodes, node.id), rest)
  }

  return rewriteVariableRefs(structuredClone(data), nodeIds, mapPath)
}
