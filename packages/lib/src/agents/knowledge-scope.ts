// packages/lib/src/agents/knowledge-scope.ts

import type { KnowledgeEntry } from '@auxx/database'

/**
 * Resource-id prefixes a knowledge-scope row may target.
 *
 * `Agent.knowledge` used to double as an entity-record include list; that job
 * moved to the permission layer (per-def / per-instance grants, doc 14), and
 * this column is now purely a **retrieval scope**: which knowledge sources
 * `search_knowledge` and the prompt's Knowledge Catalog look at by default.
 * See plans/permissions/v2/15-agent-knowledge-scope.md §0.
 */
export const KNOWLEDGE_SCOPE_PREFIXES = ['kb', 'article', 'dataset'] as const

export type KnowledgeScopePrefix = (typeof KNOWLEDGE_SCOPE_PREFIXES)[number]

const PREFIX_SET = new Set<string>(KNOWLEDGE_SCOPE_PREFIXES)

/**
 * Prefixes that also work as a bare, definition-level row meaning "every one of
 * these". Articles are excluded: a bare `article` row would mean "every article
 * in the org", which a bare `kb` row already says.
 */
const DEFINITION_LEVEL_PREFIXES = new Set<string>(['kb', 'dataset'])

/**
 * Split a scope `recordId` into its resource prefix and instance id.
 * `kb` → definition-level ("all knowledge bases"); `kb:abc` → one KB.
 * Returns `null` for anything outside {@link KNOWLEDGE_SCOPE_PREFIXES}.
 */
export function parseKnowledgeScopeRecordId(
  recordId: string
): { prefix: KnowledgeScopePrefix; instanceId: string | null } | null {
  const colon = recordId.indexOf(':')
  if (colon === -1) {
    return DEFINITION_LEVEL_PREFIXES.has(recordId)
      ? { prefix: recordId as KnowledgeScopePrefix, instanceId: null }
      : null
  }
  const prefix = recordId.slice(0, colon)
  const instanceId = recordId.slice(colon + 1)
  if (!PREFIX_SET.has(prefix) || instanceId.length === 0) return null
  return { prefix: prefix as KnowledgeScopePrefix, instanceId }
}

/**
 * Whether `recordId` is a valid knowledge-scope target. The single validation
 * predicate shared by the `agentScope` router, the scope service, and the
 * agents-builder LLM tool, so all three reject the same ids.
 */
export function isKnowledgeScopeRecordId(recordId: string): boolean {
  return parseKnowledgeScopeRecordId(recordId) !== null
}

/**
 * Drop entries whose `recordId` is not a knowledge source.
 *
 * Read-time defence (§0.6): `AgentVersion` snapshots are immutable and older
 * ones still carry entity-record rows from the deleted include system. Every
 * runtime consumer funnels through here, so those rows are inert without
 * rewriting history.
 */
export function filterKnowledgeScopeEntries(
  entries: readonly KnowledgeEntry[] | null | undefined
): KnowledgeEntry[] {
  if (!entries || entries.length === 0) return []
  return entries.filter((e) => isKnowledgeScopeRecordId(e.recordId))
}

/**
 * The knowledge-scope rows of an agent, bucketed by target and direction.
 * Purely structural — ids are not validated against the org here (that happens
 * in `resolveAgentKnowledgeScope`, which also drops dangling ones).
 */
export interface AgentKnowledgeScope {
  /** Definition-level `kb` row — the default for KBs with no row of their own. */
  allKbs: 'include' | 'exclude' | null
  /** Definition-level `dataset` row. */
  allDatasets: 'include' | 'exclude' | null
  /** KBs included whole. Any include mode on a KB means its entire content. */
  kbIds: string[]
  /** Articles included on their own (`include_one`) — no descendants. */
  articleIds: string[]
  /** Articles included with their subtree (`include_descendants`). */
  articleTreeIds: string[]
  /** Standalone RAG datasets included. */
  datasetIds: string[]
  excludedKbIds: string[]
  /** Excluded articles. Exclusion always covers the subtree (mirrors the UI). */
  excludedArticleIds: string[]
  excludedDatasetIds: string[]
}

/**
 * Bucket an agent's knowledge rows into an {@link AgentKnowledgeScope}.
 *
 * Returns `null` when the agent has no knowledge-source rows at all — the
 * unrestricted default (§0.3: empty scope = all org knowledge). Entity-record
 * rows left over from the old include system are ignored, so an agent carrying
 * only those is still unrestricted.
 *
 * Pure — safe to call from client code.
 */
export function parseAgentKnowledgeScope(
  entries: readonly KnowledgeEntry[] | null | undefined
): AgentKnowledgeScope | null {
  const rows = filterKnowledgeScopeEntries(entries)
  if (rows.length === 0) return null

  const scope: AgentKnowledgeScope = {
    allKbs: null,
    allDatasets: null,
    kbIds: [],
    articleIds: [],
    articleTreeIds: [],
    datasetIds: [],
    excludedKbIds: [],
    excludedArticleIds: [],
    excludedDatasetIds: [],
  }

  for (const row of rows) {
    const parsed = parseKnowledgeScopeRecordId(row.recordId)
    if (!parsed) continue
    const { prefix, instanceId } = parsed
    const isExclude = row.mode === 'exclude'

    if (instanceId === null) {
      const direction = isExclude ? 'exclude' : 'include'
      if (prefix === 'kb') scope.allKbs = direction
      else if (prefix === 'dataset') scope.allDatasets = direction
      continue
    }

    if (prefix === 'kb') {
      ;(isExclude ? scope.excludedKbIds : scope.kbIds).push(instanceId)
    } else if (prefix === 'dataset') {
      ;(isExclude ? scope.excludedDatasetIds : scope.datasetIds).push(instanceId)
    } else if (isExclude) {
      scope.excludedArticleIds.push(instanceId)
    } else if (row.mode === 'include_descendants') {
      scope.articleTreeIds.push(instanceId)
    } else {
      scope.articleIds.push(instanceId)
    }
  }

  return scope
}

/**
 * Whether the scope names anything to include. When it doesn't (exclude rows
 * only), the searchable set starts org-wide and the excludes carve out of it
 * (§0.3).
 */
export function scopeHasIncludes(scope: AgentKnowledgeScope): boolean {
  return (
    scope.allKbs === 'include' ||
    scope.allDatasets === 'include' ||
    scope.kbIds.length > 0 ||
    scope.articleIds.length > 0 ||
    scope.articleTreeIds.length > 0 ||
    scope.datasetIds.length > 0
  )
}
