// packages/lib/src/workflow-engine/catalog/nodes/knowledge-retrieval.ts

import { z } from 'zod'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { ErrorStrategy, errorHandlingBranches, errorStrategySchema } from '../error-handling'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { createNestedVariable } from '../variable-conversion'
import { extractFieldVariableIds, isVariableMode } from '../variable-inference'

/**
 * The knowledge-retrieval node's catalog manifest.
 *
 * The data half (source-row union, zod schema, defaults, validator, variable
 * extraction, output resolver) lives here as the single source; apps/web
 * `core/knowledge-retrieval/schema.ts` merges it with the React parts via
 * `defineFromManifest`, and `core/knowledge-retrieval/output-variables.ts`
 * re-exports {@link getKnowledgeRetrievalOutputVariables} so the builder and
 * the server cannot produce different variable trees.
 *
 * Engine note: the processor
 * (`workflow-engine/nodes/dataset/knowledge-retrieval.ts`) keeps its own
 * runtime-facing config schema, because it must also accept the *resolved*
 * shapes that variable binding produces. This manifest describes the PERSISTED
 * builder config.
 */

/** Search strategies the retrieval node dispatches. */
export const KNOWLEDGE_SEARCH_TYPES = ['vector', 'text', 'hybrid'] as const
export type KnowledgeSearchType = (typeof KNOWLEDGE_SEARCH_TYPES)[number]

/**
 * One selected knowledge source.
 *
 * The row's `kind` is STORED, never inferred from which id field is populated —
 * a row whose id is variable-bound still has to know which picker it renders
 * and which resolver arm it belongs to.
 */
export type KnowledgeSourceRow =
  | { kind: 'dataset'; datasetId: string }
  | { kind: 'kb'; knowledgeBaseId: string }

/** The `fieldModes` key for a row's id field — kind-dependent. */
export function sourceFieldKey(row: KnowledgeSourceRow, index: number): string {
  return row.kind === 'kb' ? `sources.${index}.knowledgeBaseId` : `sources.${index}.datasetId`
}

/** The raw (possibly variable-reference) id a row carries. */
export function sourceRawId(row: KnowledgeSourceRow): string {
  return row.kind === 'kb' ? row.knowledgeBaseId : row.datasetId
}

/**
 * Upper bound on `limit` (K9). Mirrors `MAX_LIMIT` in the engine processor and
 * the clamp in data-migration 087 — all three must move together.
 */
export const KNOWLEDGE_RETRIEVAL_MAX_LIMIT = 25

/**
 * Knowledge Retrieval node data interface.
 */
export interface KnowledgeRetrievalNodeData extends BaseNodeData {
  /** Short description */
  desc?: string

  // === Query Input ===
  /** Search query text (from variable or constant) */
  query?: string

  // === Knowledge Selection ===
  /** Knowledge bases and/or RAG datasets to search across */
  sources?: KnowledgeSourceRow[]

  // === Search Configuration ===
  /**
   * Search strategy: 'vector', 'text', or 'hybrid' (default: 'hybrid').
   * A variable reference string when bound to a variable.
   */
  searchType?: KnowledgeSearchType | string
  /** Maximum number of results (default 20, max 25). A string when bound. */
  limit?: number | string
  /**
   * Minimum similarity threshold for vector search (0-1).
   * **No default** (K7) — unset lets the vector lane's own 0.4 floor apply,
   * which is what the `search_knowledge` agent path gets over identical
   * content. A string when bound to a variable.
   */
  similarityThreshold?: number | string
  /**
   * Return one best passage per article/document instead of raw segments (K8).
   * Schema-optional so existing nodes keep raw segments; `defaultData` sets it
   * true so new nodes get the good behaviour.
   */
  dedupePerDocument?: boolean | string
  /**
   * Keep only segments whose `metadata.links[]` include one of these record
   * ids — "search knowledge relevant to *this* contact/order".
   */
  recordIds?: string[] | string

  /** Track constant/variable mode per field */
  fieldModes?: Record<string, boolean>
  /**
   * What happens when this node fails — `fail` (route to the wireable `fail`
   * branch) or `continue` (succeed on `source` with `success: false` and the
   * error in the output). Optional: no node persisted before plan 21 step 4
   * carries the key, and an absent value renders no branch.
   */
  error_strategy?: ErrorStrategy
}

/**
 * Knowledge source row schema — a discriminated union so a row's kind survives
 * a variable-bound id.
 */
const sourceRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dataset'), datasetId: z.string() }),
  z.object({ kind: z.literal('kb'), knowledgeBaseId: z.string() }),
])

/**
 * Zod schema for Knowledge Retrieval node data.
 *
 * Bindable search settings accept the variable reference string the panel
 * stores in variable mode alongside their literal type — a bare `z.number()`
 * would reject the reference before it is ever looked up. Ranges are enforced
 * against the RESOLVED value in the processor.
 *
 * `sources` is deliberately OPTIONAL here with required-ness carried by
 * {@link validateKnowledgeRetrievalConfig}: the catalog coverage test parses
 * `defaultData()` against this schema, and a fresh node legitimately has no
 * sources yet. Never add `.min(1)`.
 */
export const knowledgeRetrievalNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().min(1),
  desc: z.string().optional(),

  // Query input
  query: z.string().optional(),

  // Knowledge selection — knowledge bases and/or RAG datasets
  sources: z.array(sourceRowSchema).optional(),

  // Search configuration
  searchType: z.union([z.enum(KNOWLEDGE_SEARCH_TYPES), z.string()]).optional(),
  limit: z.union([z.number().min(1).max(KNOWLEDGE_RETRIEVAL_MAX_LIMIT), z.string()]).optional(),
  similarityThreshold: z.union([z.number().min(0).max(1), z.string()]).optional(),
  dedupePerDocument: z.union([z.boolean(), z.string()]).optional(),
  recordIds: z.union([z.array(z.string()), z.string()]).optional(),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),

  // Failure policy — see `catalog/error-handling.ts`.
  error_strategy: errorStrategySchema.optional(),
})

/**
 * Default configuration for new Knowledge Retrieval nodes.
 */
export const knowledgeRetrievalDefaultData = (): Partial<KnowledgeRetrievalNodeData> => ({
  title: 'Knowledge Retrieval',
  desc: 'Search knowledge bases and datasets for relevant content',
  searchType: 'hybrid',
  limit: 20,
  // similarityThreshold deliberately unset (K7).
  // New nodes get one-passage-per-article; existing nodes keep raw segments
  // because the schema leaves it optional.
  dedupePerDocument: true,
  sources: [],
  fieldModes: {
    query: false, // Default to variable mode for query
    searchType: true, // Default to constant mode
    limit: true,
    similarityThreshold: true,
    dedupePerDocument: true,
  },
  // Written on create for the same reason http/crud write it: `fail` is what
  // an unset node ALREADY does (`normalizeErrorStrategy(undefined)`), so the
  // processor emits `outputHandle: 'fail'` on failure either way — persisting
  // it is the node telling the truth about the handle it emits instead of
  // recreating the undeclared-handle defect this opt-in exists to remove
  // (plan 21 §14.4). Existing rows keep no key, and therefore no branch.
  error_strategy: ErrorStrategy.fail,
  _targetBranches: [
    { id: 'source', name: '', type: 'default' },
    { id: 'fail', name: 'Fail', type: 'fail' },
  ],
})

/**
 * Extract variable references from a Knowledge Retrieval configuration.
 *
 * Moved verbatim from apps/web `core/knowledge-retrieval/schema.ts`. Note
 * `isVariableMode` is `fieldModes[field] !== true` — variable mode is the
 * DEFAULT here. That is deliberately NOT the same default the engine processor
 * applies when resolving a source row (`!== false`, constant by default); the
 * asymmetry is pre-existing and out of scope for the migration, but it means an
 * un-moded row is declared as a variable and resolved as a literal.
 */
export function extractKnowledgeRetrievalVariables(
  data: Partial<KnowledgeRetrievalNodeData>
): string[] {
  const variableIds = new Set<string>()
  const fieldModes = data.fieldModes

  // Extract from query (if in variable mode)
  if (data.query && isVariableMode(fieldModes, 'query')) {
    extractFieldVariableIds(data.query).forEach((id) => variableIds.add(id))
  }

  // Extract from sources (each row's id can be a variable)
  if (data.sources && Array.isArray(data.sources)) {
    data.sources.forEach((row, index) => {
      const rawId = sourceRawId(row)
      if (rawId && isVariableMode(fieldModes, sourceFieldKey(row, index))) {
        extractFieldVariableIds(rawId).forEach((id) => variableIds.add(id))
      }
    })
  }

  // Extract from searchType (if in variable mode)
  if (data.searchType && isVariableMode(fieldModes, 'searchType')) {
    extractFieldVariableIds(data.searchType).forEach((id) => variableIds.add(id))
  }

  // Extract from limit (if in variable mode)
  if (data.limit !== undefined && isVariableMode(fieldModes, 'limit')) {
    extractFieldVariableIds(String(data.limit)).forEach((id) => variableIds.add(id))
  }

  // Extract from similarityThreshold (if in variable mode)
  if (data.similarityThreshold !== undefined && isVariableMode(fieldModes, 'similarityThreshold')) {
    extractFieldVariableIds(String(data.similarityThreshold)).forEach((id) => variableIds.add(id))
  }

  return Array.from(variableIds)
}

/**
 * Validation for Knowledge Retrieval configuration.
 *
 * Carries the required-ness the schema deliberately omits (see the schema
 * docblock), and K3's author-time warning: a variable-bound source id cannot
 * be checked here — the runtime resolution fails closed instead. Do NOT add a
 * "helpful" author-time lookup; a bound id would fail it anyway.
 */
export function validateKnowledgeRetrievalConfig(
  data: KnowledgeRetrievalNodeData
): NodeValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  if (!data.query?.trim()) {
    errors.push({ field: 'query', message: 'Query is required', type: 'error' })
  }

  if (!data.sources || data.sources.length === 0) {
    errors.push({
      field: 'sources',
      message: 'At least one knowledge source must be selected',
      type: 'error',
    })
  }

  data.sources?.forEach((row, index) => {
    const fieldKey = sourceFieldKey(row, index)
    // Explicit `=== false` (bound), matching the ENGINE validator — NOT the
    // `isVariableMode` helper used for extraction, whose default is inverted.
    if (data.fieldModes?.[fieldKey] === false) {
      errors.push({
        field: fieldKey,
        message: `Source ${index + 1} is bound to a variable — it cannot be verified until the workflow runs`,
        type: 'warning',
      })
    } else if (!sourceRawId(row)?.trim()) {
      errors.push({
        field: fieldKey,
        message: `Source ${index + 1} is empty`,
        type: 'error',
      })
    }
  })

  // Literal ranges only — a bound field holds a reference whose value is not
  // known until the run, and is range-checked there.
  if (
    typeof data.limit === 'number' &&
    (data.limit < 1 || data.limit > KNOWLEDGE_RETRIEVAL_MAX_LIMIT)
  ) {
    errors.push({
      field: 'limit',
      message: `Limit must be between 1 and ${KNOWLEDGE_RETRIEVAL_MAX_LIMIT}`,
      type: 'error',
    })
  }

  if (
    typeof data.similarityThreshold === 'number' &&
    (data.similarityThreshold < 0 || data.similarityThreshold > 1)
  ) {
    errors.push({
      field: 'similarityThreshold',
      message: 'Similarity threshold must be between 0 and 1',
      type: 'error',
    })
  }

  if (data.searchType === 'text' && data.similarityThreshold !== undefined) {
    errors.push({
      field: 'similarityThreshold',
      message: 'Similarity threshold has no effect for text-only search',
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Output variables for the Knowledge Retrieval node.
 *
 * Matches what `KnowledgeRetrievalProcessor.storeOutputVariables` writes. The
 * per-result KB provenance fields (`source` … `docSlug`) landed with #1642 —
 * they are what lets a downstream `answer`/`ai` node cite an article and a
 * `crud` node link a reply back to it.
 *
 * apps/web `core/knowledge-retrieval/output-variables.ts` re-exports this, so
 * the builder picker and the server resolver cannot drift.
 */
export function getKnowledgeRetrievalOutputVariables(
  _data: KnowledgeRetrievalNodeData,
  nodeId: string
): UnifiedVariable[] {
  return [
    // Results array with full search result structure
    createNestedVariable({
      nodeId,
      basePath: 'results',
      type: BaseType.ARRAY,
      label: 'Results',
      description: 'Array of search results from datasets',
      items: {
        type: BaseType.OBJECT,
        label: 'Search Result',
        description: 'A single search result',
        properties: {
          content: {
            type: BaseType.STRING,
            label: 'Content',
            description: 'Text content of the segment',
          },
          score: {
            type: BaseType.NUMBER,
            label: 'Score',
            description: 'Relevance score (higher is more relevant)',
          },
          rank: {
            type: BaseType.NUMBER,
            label: 'Rank',
            description: 'Position in search results (1-based)',
          },
          segmentId: {
            type: BaseType.STRING,
            label: 'Segment ID',
            description: 'ID of the document segment',
          },
          documentId: {
            type: BaseType.STRING,
            label: 'Document ID',
            description: 'ID of the parent document',
          },
          documentTitle: {
            type: BaseType.STRING,
            label: 'Document Title',
            description: 'Title of the parent document',
          },
          datasetId: {
            type: BaseType.STRING,
            label: 'Dataset ID',
            description: 'ID of the source dataset',
          },
          datasetName: {
            type: BaseType.STRING,
            label: 'Dataset Name',
            description: 'Name of the source dataset',
          },
          position: {
            type: BaseType.NUMBER,
            label: 'Position',
            description: 'Segment position within document',
          },
          searchType: {
            type: BaseType.STRING,
            label: 'Search Type',
            description: 'Type of search that found this result',
          },
          source: {
            type: BaseType.STRING,
            label: 'Source',
            description: "'kb' for a knowledge-base article, 'rag' for an uploaded document",
          },
          articleId: {
            type: BaseType.STRING,
            label: 'Article ID',
            description: 'ID of the KB article (KB results only)',
          },
          articleSlug: {
            type: BaseType.STRING,
            label: 'Article Slug',
            description: 'Slug of the KB article (KB results only)',
          },
          articleSlugPath: {
            type: BaseType.STRING,
            label: 'Article Slug Path',
            description: 'Full slug path of the KB article within its KB (KB results only)',
          },
          kbId: {
            type: BaseType.STRING,
            label: 'Knowledge Base ID',
            description: 'ID of the knowledge base (KB results only)',
          },
          kbSlug: {
            type: BaseType.STRING,
            label: 'Knowledge Base Slug',
            description: 'Slug of the knowledge base (KB results only)',
          },
          docSlug: {
            type: BaseType.STRING,
            label: 'Doc Slug',
            description:
              'kbSlug/articleSlugPath — cite as [Title](auxx://doc/<docSlug>) (KB results only)',
          },
        },
      },
    }),

    // Total count
    createNestedVariable({
      nodeId,
      basePath: 'total',
      type: BaseType.NUMBER,
      label: 'Total',
      description: 'Total number of results found',
    }),

    // Response time
    createNestedVariable({
      nodeId,
      basePath: 'responseTime',
      type: BaseType.NUMBER,
      label: 'Response Time',
      description: 'Search execution time in milliseconds',
    }),

    // Pagination flag
    createNestedVariable({
      nodeId,
      basePath: 'hasMore',
      type: BaseType.BOOLEAN,
      label: 'Has More',
      description: 'Whether more results are available beyond the limit',
    }),

    // Original query echo
    createNestedVariable({
      nodeId,
      basePath: 'query',
      type: BaseType.STRING,
      label: 'Query',
      description: 'The original search query',
    }),

    // Search type used
    createNestedVariable({
      nodeId,
      basePath: 'searchType',
      type: BaseType.STRING,
      label: 'Search Type',
      description: 'The search strategy used (vector/text/hybrid)',
    }),

    // Success flag
    createNestedVariable({
      nodeId,
      basePath: 'success',
      type: BaseType.BOOLEAN,
      label: 'Success',
      description: 'Whether the search completed successfully',
    }),

    // Error message
    createNestedVariable({
      nodeId,
      basePath: 'error',
      type: BaseType.STRING,
      label: 'Error',
      description: 'Error message if search failed (null if successful)',
    }),
  ]
}

/**
 * Knowledge Retrieval node manifest.
 */
export const knowledgeRetrievalManifest: NodeManifest<KnowledgeRetrievalNodeData> = {
  id: 'knowledge-retrieval',
  category: NodeCategory.DATASET,
  displayName: 'Knowledge Retrieval',
  description:
    'Search knowledge bases and datasets for relevant content using vector, text, or hybrid search',
  icon: 'search',
  color: '#06b6d4',
  defaultData: knowledgeRetrievalDefaultData,
  configSchema:
    knowledgeRetrievalNodeDataSchema as unknown as z.ZodType<KnowledgeRetrievalNodeData>,
  validate: validateKnowledgeRetrievalConfig,
  extractVariables: extractKnowledgeRetrievalVariables,
  resolveOutputs: getKnowledgeRetrievalOutputVariables,
  connection: {
    canRunSingle: true,
    /**
     * Successful runs leave via `source`; the `fail` branch comes from the
     * shared helper, the single site that turns `error_strategy: 'fail'` into
     * a handle (plan 21 §15.4).
     */
    branches: (config): NodeBranch[] => [
      { id: 'source', name: '', kind: 'default' },
      ...errorHandlingBranches(config),
    ],
  },
  /**
   * A substitute set of retrieved documents is not a coherent thing; an empty
   * result with `success: false` is (plan 21 §16.3). So no `default`.
   */
  errorHandling: {
    // `fail` only. `continue` here means empty context reaches the AI node
    // downstream, which then answers a customer confidently from nothing — a
    // failed run is strictly better than a fabricated answer (plan 24 §6.5).
    strategies: [ErrorStrategy.fail],
    defaultStrategy: ErrorStrategy.fail,
  },
  agent: {
    authorable: true,
    usage:
      'Search the organization’s knowledge for passages relevant to a query. `sources` is a ' +
      'list of rows, each either { kind: "kb", knowledgeBaseId } or { kind: "dataset", datasetId } ' +
      '— at least one is required, and there is no implicit "all knowledge bases". `query` is ' +
      'required and usually references an upstream variable. Set `dedupePerDocument` to return ' +
      'one best passage per article rather than raw segments. `limit` is capped at 25 because ' +
      'passages are prose and feed the next prompt untruncated. ' +
      '`error_strategy` is fail (the default — exposes a wirable "fail" branch handle; ' +
      'leaving it unwired just means the run dies, which is the normal shape) or continue ' +
      '(succeed on "source" with `success: false` and the error in the output).',
    examples: [
      {
        description: 'Search one knowledge base for text from an inbound email',
        config: {
          query: '{{trigger_1.message.subject}} {{trigger_1.message.body}}',
          sources: [{ kind: 'kb', knowledgeBaseId: 'kb_abc123' }],
          searchType: 'hybrid',
          limit: 5,
          dedupePerDocument: true,
        },
      },
      {
        description: 'Search an uploaded RAG dataset only',
        config: {
          query: '{{trigger_1.question}}',
          sources: [{ kind: 'dataset', datasetId: 'ds_abc123' }],
          searchType: 'vector',
        },
      },
    ],
  },
}
