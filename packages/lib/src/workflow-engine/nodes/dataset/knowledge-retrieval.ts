// packages/lib/src/workflow-engine/nodes/dataset/knowledge-retrieval.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import type { KnowledgeTarget } from '../../../datasets/resolve-knowledge-targets'
import { resolveKnowledgeDatasetIds } from '../../../datasets/resolve-knowledge-targets'
import { SearchService } from '../../../datasets/services/search.service'
import type { SearchQuery, SearchResult, SearchType } from '../../../datasets/types/search.types'
import { ErrorStrategy, normalizeErrorStrategy } from '../../catalog/error-handling'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowActionType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import { extractVariableRefs } from '../utils/variable-refs'
import { resolveEnumConfig, resolveNumberConfig, variableBound } from './config-value'

const logger = createScopedLogger('knowledge-retrieval-processor')

/**
 * One selected knowledge source. The row's `kind` is stored, never inferred, so
 * a row whose id is variable-bound still knows which picker and which resolver
 * arm it belongs to.
 */
export type KnowledgeSourceRow =
  | { kind: 'dataset'; datasetId: string }
  | { kind: 'kb'; knowledgeBaseId: string }

/** The `fieldModes` key for a row's id field — kind-dependent. */
function sourceFieldKey(row: KnowledgeSourceRow, index: number): string {
  return row.kind === 'kb' ? `sources.${index}.knowledgeBaseId` : `sources.${index}.datasetId`
}

/** The raw (possibly variable-reference) id a row carries. */
function sourceRawId(row: KnowledgeSourceRow): string {
  return row.kind === 'kb' ? row.knowledgeBaseId : row.datasetId
}

/**
 * Knowledge Retrieval node configuration
 */
interface KnowledgeRetrievalConfig {
  title?: string
  desc?: string

  // Query input
  query?: string

  // Knowledge selection — knowledge bases and/or RAG datasets
  sources?: KnowledgeSourceRow[]

  // Search configuration
  // Each carries a variable reference string when bound to a variable
  searchType?: SearchType | string
  limit?: number | string
  similarityThreshold?: number | string
  /** One best passage per article/document (K8). Schema default false. */
  dedupePerDocument?: boolean | string
  /** Keep only segments whose `metadata.links[]` include one of these records. */
  recordIds?: string[] | string

  // Field modes tracking (constant vs variable)
  fieldModes?: Record<string, boolean>
}

/**
 * Simplified search result for workflow output
 * Flattens the nested SearchResult structure for easier downstream access
 */
interface KnowledgeRetrievalResultItem {
  content: string
  score: number
  rank: number
  segmentId: string
  documentId: string
  documentTitle: string
  datasetId: string
  datasetName: string
  position: number
  searchType: string

  // === KB provenance (additive; absent on RAG segments) ===
  /** `'kb'` for a knowledge-base article, `'rag'` for an uploaded document. */
  source: 'kb' | 'rag'
  articleId?: string
  articleSlug?: string
  articleSlugPath?: string
  kbId?: string
  kbSlug?: string
  /** `<kbSlug>/<articleSlugPath>` — cite as `[Title](auxx://doc/<docSlug>)`. */
  docSlug?: string
}

/** Segment metadata written by `KBSyncService` for KB-sourced segments. */
interface SegmentMeta {
  source?: string
  articleId?: string
  articleSlug?: string
  articleSlugPath?: string
  kbId?: string
  kbSlug?: string
  links?: Array<{ recordId?: string }>
}

/**
 * Read a segment's metadata.
 *
 * ⚠ The two search lanes populate this from DIFFERENT columns — the vector lane
 * from `DocumentSegment.searchMetadata`, the full-text lane from
 * `DocumentSegment.metadata` — and hybrid mixes both, so the same article can
 * come back with metadata sourced from either.
 *
 * They agree structurally, not by coincidence: `metadata` is written at chunk
 * time from `KBSyncService`'s `baseMetadata`, and `searchMetadata` is derived
 * from it at embed time (`embedding-processor.ts` spreads `segment.metadata`
 * LAST over its own derived keys, so KB fields cannot be clobbered, and
 * `postgresql.ts` writes that object to `searchMetadata`). A segment that was
 * chunked but never embedded has a null `searchMetadata`, but it also has
 * `indexStatus != 'INDEXED'` and the vector SQL requires INDEXED — so it can
 * only ever come back through the full-text lane, which reads the populated
 * column. There is no shape where a KB hit arrives unlabelled.
 */
function readSegmentMeta(result: SearchResult): SegmentMeta {
  return ((result.segment.metadata as SegmentMeta | null) ?? {}) as SegmentMeta
}

/**
 * Knowledge Retrieval output structure
 */
interface KnowledgeRetrievalOutput {
  results: KnowledgeRetrievalResultItem[]
  total: number
  responseTime: number
  hasMore: boolean
  query: string
  searchType: string
  success: boolean
  error?: string
}

/**
 * Validation schema for Knowledge Retrieval configuration
 */
const sourceRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dataset'), datasetId: z.string() }),
  z.object({ kind: z.literal('kb'), knowledgeBaseId: z.string() }),
])

/** Search types the retrieval node knows how to dispatch */
const SEARCH_TYPES = ['vector', 'text', 'hybrid'] as const

/** Defaults applied when a search-configuration field is unset or unresolvable */
const DEFAULT_SEARCH_TYPE: SearchType = 'hybrid'
const DEFAULT_LIMIT = 20

/**
 * Upper bound on `limit` (K9).
 *
 * Was 100. Chunks default to 1000 chars and this node deliberately does NOT
 * truncate `results[].content` (a downstream `ai`/`answer` node consumes it),
 * so a 100-result run put ~25k tokens into the next prompt. 25 sits just above
 * the node's default of 20, bounding the worst case to the same order as the
 * default rather than 5x it. With `dedupePerDocument` on, 100 would mean 100
 * distinct articles — that is re-ranking territory, and re-ranking is out of
 * scope (it is accepted by `VectorSearchOptions` and silently ignored).
 */
const MAX_LIMIT = 25

/**
 * Over-fetch multiplier when results are post-filtered, mirroring
 * `search_knowledge`: dedupe and `recordIds` both cut the raw segment list, so
 * it must be several times the requested page to survive the cuts.
 */
const OVERFETCH_MIN = 15
const OVERFETCH_MAX = 50

// NOTE — `similarityThreshold` deliberately has NO node-level default (K7).
// It used to default to 0.7 while the vector lane's own floor is 0.4 (chosen
// deliberately — see the comment in `search/vector-search.ts`), so pointing the
// node at a knowledge base gave materially worse recall than the
// `search_knowledge` path over identical content, which passes nothing. Leaving
// it unset lets the lane default apply and makes the two agree. This is an
// observable change for existing nodes: they return more results, at lower
// scores.

/**
 * Validation schema for Knowledge Retrieval configuration
 *
 * The bindable search-configuration fields are widened with
 * {@link variableBound}: in variable mode the builder stores a reference string
 * (`"trigger_1.limit"`), which a bare `z.number()` / `z.enum()` would reject —
 * failing the node before the variable is ever looked up. Ranges are enforced
 * in `preprocessNode` against the resolved value instead.
 */
const knowledgeRetrievalConfigSchema = z.object({
  title: z.string().optional().default('Knowledge Retrieval'),
  desc: z.string().optional(),
  query: z.string().optional(),
  sources: z.array(sourceRowSchema).optional(),
  searchType: variableBound(z.enum(SEARCH_TYPES)).optional(),
  limit: variableBound(z.number().min(1).max(MAX_LIMIT)).optional(),
  similarityThreshold: variableBound(z.number().min(0).max(1)).optional(),
  dedupePerDocument: z.union([z.boolean(), z.string()]).optional(),
  recordIds: z.union([z.array(z.string()), z.string()]).optional(),
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Knowledge Retrieval Node Processor
 *
 * Performs semantic search across one or more datasets using the existing
 * SearchService infrastructure. Supports vector, text, and hybrid search modes.
 *
 * This is the retrieval step in RAG pipelines:
 * Dataset (indexing) → ... → Knowledge Retrieval (query) → LLM (generate)
 */
export class KnowledgeRetrievalProcessor extends BaseNodeProcessor {
  readonly type = WorkflowActionType.KNOWLEDGE_RETRIEVAL

  /**
   * Preprocess node - validate config and resolve variables
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    // Validate configuration
    const configResult = knowledgeRetrievalConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      throw this.createProcessingError(
        `Invalid Knowledge Retrieval configuration: ${configResult.error.issues.map((e) => e.message).join(', ')}`,
        node,
        { validationErrors: configResult.error.issues }
      )
    }

    const config = configResult.data as KnowledgeRetrievalConfig
    const usedVariables = new Set<string>()
    const resolveValue = (raw: string) => this.resolveVariableValue(raw, contextManager)

    // === Resolve query ===
    if (!config.query) {
      throw this.createProcessingError('Query is required', node, { config })
    }

    const isQueryConstantMode = config.fieldModes?.query === true
    let resolvedQuery: string

    if (isQueryConstantMode) {
      resolvedQuery = config.query
    } else {
      // Variable mode - interpolate variables in the query
      resolvedQuery = await this.interpolateVariables(config.query, contextManager)
      this.extractVariableIds(config.query).forEach((v) => usedVariables.add(v))
      // Also check if it's a direct variable reference
      if (config.query.includes('.')) {
        const directValue = await contextManager.getVariable(config.query)
        if (typeof directValue === 'string' || typeof directValue === 'number') {
          resolvedQuery = String(directValue)
          usedVariables.add(config.query)
        }
      }
    }

    if (!resolvedQuery || resolvedQuery.trim().length === 0) {
      throw this.createProcessingError('Query resolved to empty value', node, {
        originalQuery: config.query,
        isConstantMode: isQueryConstantMode,
      })
    }

    // === Resolve knowledge sources ===
    if (!config.sources || config.sources.length === 0) {
      throw this.createProcessingError('At least one knowledge source must be selected', node, {
        config,
      })
    }

    // Each row resolves independently and FAILS CLOSED (K3): a variable-bound id
    // that resolves to nothing contributes nothing while its siblings still
    // search. Only an empty set after resolution is an error.
    const targets: KnowledgeTarget[] = []

    for (let i = 0; i < config.sources.length; i++) {
      const row = config.sources[i]
      const rawId = row ? sourceRawId(row) : ''
      if (!row || !rawId) continue

      const fieldKey = sourceFieldKey(row, i)
      const isConstantMode = config.fieldModes?.[fieldKey] !== false // Default to constant mode

      let resolvedId: string | undefined

      if (isConstantMode) {
        resolvedId = rawId
      } else {
        // Variable mode — extractIdFromValue unwraps ResourceReference objects,
        // so `{{find_1.record}}` pointing at a KB works with no extra handling.
        resolvedId = await this.extractIdFromValue(rawId, contextManager)
        this.extractVariableIds(rawId).forEach((v) => usedVariables.add(v))
        if (rawId.includes('.')) {
          usedVariables.add(rawId)
        }
        // `resolveVariableValue` echoes the reference back when the variable is
        // missing, so an unresolved binding arrives here as its own path string.
        // Drop it rather than sending a variable path to the resolver as an id:
        // it would cost a roundtrip, resolve to nothing anyway, and make the
        // node's `targets` telemetry lie about what it searched.
        if (resolvedId === rawId) {
          contextManager.log('WARN', node.name, 'Knowledge source variable did not resolve', {
            reference: rawId,
          })
          resolvedId = undefined
        }
      }

      if (!resolvedId) continue
      targets.push(
        row.kind === 'kb'
          ? { kind: 'kb', knowledgeBaseId: resolvedId }
          : { kind: 'dataset', datasetId: resolvedId }
      )
    }

    if (targets.length === 0) {
      throw this.createProcessingError('No valid knowledge sources after resolution', node, {
        originalSources: config.sources,
      })
    }

    // === Resolve search configuration ===
    // Each of these is a literal in constant mode and a variable reference
    // string in variable mode; resolution happens before the range check so a
    // bound field is judged on its resolved value, never on the raw reference.
    const resolvedSearchType = await resolveEnumConfig(
      config.searchType,
      SEARCH_TYPES,
      DEFAULT_SEARCH_TYPE,
      resolveValue
    )
    extractVariableRefs(config.searchType).forEach((v) => usedVariables.add(v))

    let resolvedLimit = DEFAULT_LIMIT
    const limitValue = await resolveNumberConfig(config.limit, resolveValue)
    if (limitValue !== undefined && limitValue >= 1 && limitValue <= MAX_LIMIT) {
      resolvedLimit = Math.floor(limitValue)
    }
    extractVariableRefs(config.limit).forEach((v) => usedVariables.add(v))

    // K7 — no node default. `undefined` lets the vector lane's own 0.4 apply.
    let resolvedSimilarityThreshold: number | undefined
    const thresholdValue = await resolveNumberConfig(config.similarityThreshold, resolveValue)
    if (thresholdValue !== undefined && thresholdValue >= 0 && thresholdValue <= 1) {
      resolvedSimilarityThreshold = thresholdValue
    }
    extractVariableRefs(config.similarityThreshold).forEach((v) => usedVariables.add(v))

    const dedupePerDocument = await this.resolveBooleanConfig(
      config.dedupePerDocument,
      resolveValue
    )
    extractVariableRefs(config.dedupePerDocument).forEach((v) => usedVariables.add(v))

    const recordIds = await this.resolveRecordIds(config.recordIds, resolveValue)
    extractVariableRefs(config.recordIds).forEach((v) => usedVariables.add(v))

    // Get organization and user IDs from context
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string | undefined

    if (!organizationId) {
      throw this.createProcessingError('Organization ID not available in execution context', node)
    }

    // === K5 — resolve on the workflow author's authority ===
    //
    // `SearchService.search` has NO ACL of its own: `getAccessibleDatasets`
    // filters on organizationId + status only, takes a `userId` and never uses
    // it. Everything below this line is what stands between a workflow and
    // every dataset in the org, so it must never be skipped.
    //
    // `sys.userId` is the workflow's `createdById` on every production trigger.
    // A non-member composes to an EMPTY capability set and reads deny rather
    // than running unrestricted — the correct outcome, so the only addition is
    // a loud diagnostic. Workflows are not permission principals yet; when they
    // become one, this is the single site to change.
    if (!userId) {
      throw this.createProcessingError(
        'No user in execution context — knowledge retrieval cannot resolve access and will not run unrestricted',
        node
      )
    }

    // Lazy imports — keeps module load light and avoids dragging the org cache
    // into modules that never take this path (mirrors `ai-v2.ts`).
    const [{ getCapabilities }, { getCachedMembers }] = await Promise.all([
      import('../../../permissions/capabilities/get-capabilities'),
      import('../../../cache/org-cache-helpers'),
    ])

    const capabilities = await getCapabilities(userId, organizationId)
    const principalMember = (await getCachedMembers(organizationId)).find(
      (m) => m.userId === userId
    )
    if (!principalMember || principalMember.status !== 'ACTIVE') {
      contextManager.log(
        'WARN',
        node.name,
        'Knowledge retrieval principal is not an active member — every source will deny',
        { userId }
      )
    }

    const resolved = await resolveKnowledgeDatasetIds(db, {
      organizationId,
      targets,
      capabilities,
      // K6 — there is no agent here, so no `Agent.knowledge` scope to resolve.
      // Explicit `null` (the unrestricted arm) so this reads as a decision.
      knowledgeScope: null,
    })
    if (resolved.isErr()) {
      throw this.createProcessingError(
        `Failed to resolve knowledge sources: ${resolved.error.message}`,
        node
      )
    }
    const resolvedDatasetIds = resolved.value

    // Fails closed: inaccessible or unresolvable sources contribute nothing,
    // and an empty set errors exactly as an empty selection does — it must
    // never fall through to an unscoped search.
    if (resolvedDatasetIds.length === 0) {
      throw this.createProcessingError(
        'No accessible knowledge sources — check the selected knowledge bases/datasets and the workflow author’s access',
        node,
        { targetCount: targets.length }
      )
    }

    return {
      inputs: {
        query: resolvedQuery,
        datasetIds: resolvedDatasetIds,
        searchType: resolvedSearchType,
        limit: resolvedLimit,
        similarityThreshold: resolvedSimilarityThreshold,
        dedupePerDocument,
        recordIds,
        organizationId,
        userId,
        variablesUsed: Array.from(usedVariables),
      },
      metadata: {
        nodeType: 'knowledge-retrieval',
        sourceCount: targets.length,
        datasetCount: resolvedDatasetIds.length,
        searchType: resolvedSearchType,
        limit: resolvedLimit,
        similarityThreshold: resolvedSimilarityThreshold,
        dedupePerDocument,
        variableCount: usedVariables.size,
        preprocessingComplete: true,
      },
    }
  }

  /** Resolve a bindable boolean — literal, or a variable reference to resolve. */
  private async resolveBooleanConfig(
    raw: boolean | string | undefined,
    resolveValue: (raw: string) => Promise<unknown>
  ): Promise<boolean> {
    if (typeof raw === 'boolean') return raw
    if (typeof raw !== 'string' || raw.length === 0) return false
    const value = await resolveValue(raw)
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return value === 'true'
    return false
  }

  /** Resolve a bindable record-id list — a literal array, or a bound value. */
  private async resolveRecordIds(
    raw: string[] | string | undefined,
    resolveValue: (raw: string) => Promise<unknown>
  ): Promise<string[]> {
    if (Array.isArray(raw)) return raw.filter((id) => typeof id === 'string' && id.length > 0)
    if (typeof raw !== 'string' || raw.length === 0) return []
    const value = await resolveValue(raw)
    if (Array.isArray(value)) {
      return value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    }
    return typeof value === 'string' && value.length > 0 ? [value] : []
  }

  /**
   * Execute node - perform search across datasets
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    try {
      let inputs: any

      // Use preprocessed data if available
      if (preprocessedData?.inputs) {
        inputs = preprocessedData.inputs
        contextManager.log(
          'INFO',
          node.name,
          'Executing knowledge retrieval with preprocessed data',
          {
            query: inputs.query.substring(0, 100) + (inputs.query.length > 100 ? '...' : ''),
            datasetCount: inputs.datasetIds.length,
            searchType: inputs.searchType,
            limit: inputs.limit,
          }
        )
      } else {
        // Fallback: process configuration directly (should not happen in normal flow)
        throw this.createExecutionError('Preprocessed data is required', node)
      }

      const recordIds: string[] = inputs.recordIds ?? []
      const dedupePerDocument: boolean = inputs.dedupePerDocument === true
      const needsPostFilter = dedupePerDocument || recordIds.length > 0

      // Over-fetch only when something downstream will cut the list, so an
      // unfiltered run issues exactly the query it always did.
      const fetchLimit = needsPostFilter
        ? Math.min(Math.max(inputs.limit * 3, OVERFETCH_MIN), OVERFETCH_MAX)
        : inputs.limit

      // Build search query. `similarityThreshold` is omitted when unset (K7) so
      // the vector lane's own default applies.
      const searchQuery: SearchQuery = {
        query: inputs.query,
        datasetIds: inputs.datasetIds,
        searchType: inputs.searchType,
        limit: fetchLimit,
        // Required for KB provenance — the vector lane gates metadata on it.
        includeMetadata: true,
        ...(inputs.similarityThreshold !== undefined
          ? { similarityThreshold: inputs.similarityThreshold }
          : {}),
      }

      // Execute search
      const searchResponse = await SearchService.search(
        searchQuery,
        inputs.organizationId,
        inputs.userId
      )

      let results = searchResponse.results

      if (recordIds.length > 0) {
        results = results.filter((result: SearchResult) => {
          const links = readSegmentMeta(result).links
          if (!links || links.length === 0) return false
          return links.some((l) => l.recordId && recordIds.includes(l.recordId))
        })
      }

      if (dedupePerDocument) {
        // Results arrive score-sorted, so the first segment seen for a source
        // is its best passage. Without this one long article can occupy every
        // slot and crowd out other relevant sources.
        const seen = new Set<string>()
        results = results.filter((result: SearchResult) => {
          const key =
            readSegmentMeta(result).articleId ?? result.segment.document.id ?? result.segment.id
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }

      if (needsPostFilter) results = results.slice(0, inputs.limit)

      // Transform results to flattened format for easier downstream access
      const transformedResults: KnowledgeRetrievalResultItem[] = results.map(
        (result: SearchResult) => {
          const meta = readSegmentMeta(result)
          const isKb = meta.source === 'kb'
          const docSlug =
            isKb && meta.kbSlug && meta.articleSlugPath
              ? `${meta.kbSlug}/${meta.articleSlugPath}`
              : undefined

          return {
            content: result.segment.content,
            score: result.score,
            rank: result.rank,
            segmentId: result.segment.id,
            documentId: result.segment.document.id,
            documentTitle: result.segment.document.title || result.segment.document.filename,
            datasetId: result.segment.document.dataset.id,
            datasetName: result.segment.document.dataset.name,
            position: result.segment.position,
            searchType: result.searchType,
            source: isKb ? ('kb' as const) : ('rag' as const),
            ...(meta.articleId ? { articleId: meta.articleId } : {}),
            ...(meta.articleSlug ? { articleSlug: meta.articleSlug } : {}),
            ...(meta.articleSlugPath ? { articleSlugPath: meta.articleSlugPath } : {}),
            ...(meta.kbId ? { kbId: meta.kbId } : {}),
            ...(meta.kbSlug ? { kbSlug: meta.kbSlug } : {}),
            ...(docSlug ? { docSlug } : {}),
          }
        }
      )

      // Build output
      const output: KnowledgeRetrievalOutput = {
        results: transformedResults,
        total: searchResponse.total,
        responseTime: searchResponse.responseTime,
        hasMore: searchResponse.hasMore ?? false,
        query: searchResponse.query,
        searchType: searchResponse.searchType,
        success: true,
      }

      // Store output variables
      this.storeOutputVariables(node.nodeId, output, contextManager)

      const executionTime = Date.now() - startTime

      contextManager.log('INFO', node.name, 'Knowledge retrieval completed', {
        resultsCount: transformedResults.length,
        total: searchResponse.total,
        responseTime: searchResponse.responseTime,
        executionTime,
        hasMore: output.hasMore,
      })

      return {
        status: NodeRunningStatus.Succeeded,
        output,
        outputHandle: 'source',
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Knowledge retrieval failed'

      contextManager.log('ERROR', node.name, 'Knowledge retrieval failed', {
        error: errorMessage,
        executionTime: Date.now() - startTime,
      })

      // Store error output
      const errorOutput: KnowledgeRetrievalOutput = {
        results: [],
        total: 0,
        responseTime: Date.now() - startTime,
        hasMore: false,
        query: preprocessedData?.inputs?.query || '',
        searchType: preprocessedData?.inputs?.searchType || 'hybrid',
        success: false,
        error: errorMessage,
      }
      this.storeOutputVariables(node.nodeId, errorOutput, contextManager)

      return this.failureResult(node, errorOutput, errorMessage)
    }
  }

  /**
   * Apply the node's failure policy (`catalog/error-handling.ts`).
   *
   * Replaces the `outputHandle: 'error'` this used to emit — a handle no
   * manifest declared, no `node.tsx` rendered and no edge could ever address,
   * so the run died anyway (plan 21 §14.2). Behaviour is preserved exactly for
   * a node with no stored `error_strategy`: it resolves to `fail`, emits the
   * declared `fail` handle, `findFailureEdge` finds nothing (the node never
   * rendered the handle, so no edge can exist) and the engine throws — the
   * same fatal outcome, now over a vocabulary an author can actually wire.
   *
   * The `'fail'` literal stays inline in every opted-in processor rather than
   * moving to a shared helper: the builder↔engine parity reader
   * (`apps/web/.../parity/engine-write-scrape.ts`) extracts emitted handles by
   * reading each processor FILE, so a handle emitted from a util would drop out
   * of the contract it is supposed to be pinned by.
   */
  private failureResult(
    node: WorkflowNode,
    output: KnowledgeRetrievalOutput,
    error: string
  ): Partial<NodeExecutionResult> {
    const strategy = normalizeErrorStrategy(
      (node.data as { error_strategy?: unknown }).error_strategy
    )
    if (strategy === ErrorStrategy.continue) {
      return { status: NodeRunningStatus.Succeeded, output, outputHandle: 'source' }
    }
    return { status: NodeRunningStatus.Failed, error, output, outputHandle: 'fail' }
  }

  /**
   * Store output variables in context
   */
  private storeOutputVariables(
    nodeId: string,
    result: KnowledgeRetrievalOutput,
    contextManager: ExecutionContextManager
  ): void {
    contextManager.setNodeVariable(nodeId, 'results', result.results)
    contextManager.setNodeVariable(nodeId, 'total', result.total)
    contextManager.setNodeVariable(nodeId, 'responseTime', result.responseTime)
    contextManager.setNodeVariable(nodeId, 'hasMore', result.hasMore)
    contextManager.setNodeVariable(nodeId, 'query', result.query)
    contextManager.setNodeVariable(nodeId, 'searchType', result.searchType)
    contextManager.setNodeVariable(nodeId, 'success', result.success)
    contextManager.setNodeVariable(nodeId, 'error', result.error || null)
  }

  /**
   * Extract required variables from node configuration
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as KnowledgeRetrievalConfig
    const variables = new Set<string>()

    // Extract from query (if variable mode)
    if (config.query && config.fieldModes?.query !== true) {
      this.extractVariableIds(config.query).forEach((v) => variables.add(v))
      if (config.query.includes('.')) {
        variables.add(config.query)
      }
    }

    // Extract from sources (each row's id can be a variable)
    if (config.sources && Array.isArray(config.sources)) {
      config.sources.forEach((row, index) => {
        const rawId = sourceRawId(row)
        const fieldKey = sourceFieldKey(row, index)
        if (rawId && config.fieldModes?.[fieldKey] === false) {
          this.extractVariableIds(rawId).forEach((v) => variables.add(v))
          if (rawId.includes('.')) {
            variables.add(rawId)
          }
        }
      })
    }

    // Bindable search settings — a bound field carries either a {{…}} template
    // or a bare picker path, both of which extractVariableRefs recognises
    extractVariableRefs(config.searchType).forEach((v) => variables.add(v))
    extractVariableRefs(config.limit).forEach((v) => variables.add(v))
    extractVariableRefs(config.similarityThreshold).forEach((v) => variables.add(v))
    extractVariableRefs(config.dedupePerDocument).forEach((v) => variables.add(v))
    extractVariableRefs(config.recordIds).forEach((v) => variables.add(v))

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    const configResult = knowledgeRetrievalConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      configResult.error.issues.forEach((issue) => {
        errors.push(`${issue.path.join('.')}: ${issue.message}`)
      })
      return { valid: false, errors, warnings }
    }

    const config = configResult.data

    // Validate required fields
    if (!config.query) {
      errors.push('Query is required')
    }

    if (!config.sources || config.sources.length === 0) {
      errors.push('At least one knowledge source must be selected')
    }

    // K3 — a variable-bound source id cannot be checked at author time. Warn;
    // the runtime resolution fails closed. Do NOT add a "helpful" author-time
    // lookup here: a bound id would fail it anyway.
    config.sources?.forEach((row, index) => {
      if (config.fieldModes?.[sourceFieldKey(row, index)] === false) {
        warnings.push(
          `Source ${index + 1} is bound to a variable — it cannot be verified until the workflow runs`
        )
      }
    })

    // Validate literal ranges only — a bound field holds a variable reference
    // whose value is not known until the run, and is range-checked there
    if (typeof config.limit === 'number' && (config.limit < 1 || config.limit > MAX_LIMIT)) {
      errors.push(`Limit must be between 1 and ${MAX_LIMIT}`)
    }

    if (
      typeof config.similarityThreshold === 'number' &&
      (config.similarityThreshold < 0 || config.similarityThreshold > 1)
    ) {
      errors.push('Similarity threshold must be between 0 and 1')
    }

    // Warning for text search with similarity threshold
    if (config.searchType === 'text' && config.similarityThreshold !== undefined) {
      warnings.push('Similarity threshold has no effect for text-only search')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
