// packages/lib/src/workflow-engine/catalog/nodes/dataset.ts

import type { DocumentTypeValues } from '@auxx/database/enums'
import { z } from 'zod'
import { DATASET_NODE_CONSTANTS } from '../../constants'
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
import {
  extractFieldVariableIds,
  extractVarIdsFromString,
  isVariableMode,
} from '../variable-inference'

/**
 * The dataset node's catalog manifest.
 *
 * The data half (data interface, zod schema, defaults, validator, variable
 * extraction, output resolver) lives here as the single source; apps/web
 * `core/dataset/schema.ts` merges it with the React parts via
 * `defineFromManifest`, and `core/dataset/output-variables.ts` re-exports
 * {@link getDatasetOutputVariables} so the builder picker and the server
 * resolver cannot produce different variable trees.
 *
 * Engine note: the processor (`workflow-engine/nodes/dataset/dataset.ts`) keeps
 * its own runtime-facing zod schema, because it must also accept the *resolved*
 * shapes variable binding produces. This manifest describes the PERSISTED
 * builder config.
 */

/**
 * Dataset node data interface.
 */
export interface DatasetNodeData extends BaseNodeData {
  /** Short description */
  desc?: string

  // === Dataset Selection ===
  /** Target dataset ID (from picker or variable) */
  datasetId?: string

  // === Chunks Input ===
  /** Chunked content from a Chunker node (a variable reference to `DocumentChunk[]`) */
  chunks?: string

  // === Document Settings ===
  /** Document title for identification */
  documentTitle?: string
  /** Content mime type (default 'text/plain') */
  mimeType?: string
  /** Document type (PDF, DOCX, TXT, …) */
  documentType?: (typeof DocumentTypeValues)[number]
  /** Source URL for the content */
  sourceUrl?: string
  /** Reference to source MediaAsset ID */
  fileId?: string

  // === Processing Options ===
  /** Skip embedding generation (default false). A string when bound to a variable. */
  skipEmbedding?: boolean | string
  /**
   * Pause the workflow until the embeddings for this document exist
   * (default true). A string when bound to a variable.
   */
  waitForEmbeddings?: boolean | string
  /**
   * How long that wait may last before the workflow continues anyway
   * (default 15). A string when bound to a variable.
   */
  embeddingTimeoutMinutes?: number | string
  /** Additional metadata to store with the document */
  metadata?: Record<string, unknown>

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
 * Zod schema for Dataset node data.
 *
 * The processing toggles accept the variable reference string the panel stores
 * in variable mode alongside their literal type — a bare `z.boolean()` /
 * `z.number()` would reject the reference before it is ever looked up. The
 * reference is resolved and coerced in the processor.
 *
 * `documentType` stays `z.string()` rather than the `DocumentTypeValues` enum,
 * matching the engine schema: the field is variable-bindable, so it can legally
 * hold a reference string at rest.
 */
export const datasetNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),

  // Dataset selection
  datasetId: z.string().optional(),

  // Chunks input
  chunks: z.string().optional(),

  // Document settings
  documentTitle: z.string().optional(),
  mimeType: z.string().optional().default('text/plain'),
  documentType: z.string().optional(),
  sourceUrl: z.string().optional(),
  fileId: z.string().optional(),

  // Processing options
  skipEmbedding: z.union([z.boolean(), z.string()]).optional(),
  waitForEmbeddings: z.union([z.boolean(), z.string()]).optional(),
  embeddingTimeoutMinutes: z.union([z.number(), z.string()]).optional(),
  metadata: z.record(z.string(), z.any()).optional(),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),

  // Failure policy — see `catalog/error-handling.ts`.
  error_strategy: errorStrategySchema.optional(),
})

/**
 * Default configuration for new Dataset nodes.
 */
export const datasetDefaultData = (): Partial<DatasetNodeData> => ({
  title: 'Dataset',
  desc: 'Add chunks to a dataset',
  skipEmbedding: false,
  // Waiting is the default: without it the node reports success while the
  // dataset still holds no vectors, so anything reading the dataset later in
  // the same run silently sees fewer results. Bounded by the timeout below.
  waitForEmbeddings: DATASET_NODE_CONSTANTS.EMBEDDING_WAIT.DEFAULT_WAIT_FOR_EMBEDDINGS,
  embeddingTimeoutMinutes: DATASET_NODE_CONSTANTS.EMBEDDING_WAIT.DEFAULT_TIMEOUT_MINUTES,
  mimeType: 'text/plain',
  fieldModes: {
    datasetId: true, // Default to constant mode for dataset picker
    chunks: false, // Default to variable mode for chunks
    documentTitle: true,
    skipEmbedding: true,
    waitForEmbeddings: true,
    embeddingTimeoutMinutes: true,
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
 * Extract variable references from a Dataset configuration.
 *
 * Moved verbatim from apps/web `core/dataset/schema.ts`. `chunks` is
 * deliberately mode-independent: it is always a reference to a Chunker node's
 * array output, never a literal.
 */
export function extractDatasetVariables(data: Partial<DatasetNodeData>): string[] {
  const variableIds = new Set<string>()
  const fieldModes = data.fieldModes

  // Extract from datasetId (if in variable mode)
  if (data.datasetId && isVariableMode(fieldModes, 'datasetId')) {
    extractFieldVariableIds(data.datasetId).forEach((id) => variableIds.add(id))
  }

  // Extract from chunks (typically a variable reference like "chunker.chunks")
  if (data.chunks) {
    extractFieldVariableIds(data.chunks).forEach((id) => variableIds.add(id))
  }

  // Extract from documentTitle (if in variable mode)
  if (data.documentTitle && isVariableMode(fieldModes, 'documentTitle')) {
    extractVarIdsFromString(data.documentTitle).forEach((id) => variableIds.add(id))
  }

  // Extract from sourceUrl (if in variable mode)
  if (data.sourceUrl && isVariableMode(fieldModes, 'sourceUrl')) {
    extractVarIdsFromString(data.sourceUrl).forEach((id) => variableIds.add(id))
  }

  // Extract from fileId (if in variable mode)
  if (data.fileId && isVariableMode(fieldModes, 'fileId')) {
    extractFieldVariableIds(data.fileId).forEach((id) => variableIds.add(id))
  }

  // Extract from the processing options bound to a variable — the two boolean
  // toggles and the numeric timeout all store a reference string in variable
  // mode
  for (const field of ['skipEmbedding', 'waitForEmbeddings', 'embeddingTimeoutMinutes'] as const) {
    const value = data[field]
    if (isVariableMode(fieldModes, field)) {
      extractFieldVariableIds(value).forEach((id) => variableIds.add(id))
    }
  }

  return Array.from(variableIds)
}

/**
 * Validation for Dataset configuration.
 *
 * NEW with the catalog migration — apps/web's `datasetDefinition` carried no
 * `validator` at all, so a dataset node with no target dataset and no chunks
 * passed the builder checklist and then threw at run time ("Dataset ID is
 * required" / "Chunks input is required", `nodes/dataset/dataset.ts`). These
 * two checks mirror exactly what the processor hard-requires — nothing more, so
 * a graph that runs today still publishes.
 */
export function validateDatasetConfig(data: DatasetNodeData): NodeValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  if (!data.datasetId?.trim()) {
    errors.push({ field: 'datasetId', message: 'A target dataset is required', type: 'error' })
  }

  if (!data.chunks?.trim()) {
    errors.push({
      field: 'chunks',
      message: 'Chunks input is required — connect a Chunker node and pick its Chunks output',
      type: 'error',
    })
  }

  // The engine CLAMPS an out-of-range timeout rather than failing, so this is a
  // warning: the run proceeds, just not with the number the author typed.
  const { MIN_TIMEOUT_MINUTES, MAX_TIMEOUT_MINUTES } = DATASET_NODE_CONSTANTS.EMBEDDING_WAIT
  if (
    typeof data.embeddingTimeoutMinutes === 'number' &&
    (data.embeddingTimeoutMinutes < MIN_TIMEOUT_MINUTES ||
      data.embeddingTimeoutMinutes > MAX_TIMEOUT_MINUTES)
  ) {
    errors.push({
      field: 'embeddingTimeoutMinutes',
      message: `Embedding timeout is clamped to ${MIN_TIMEOUT_MINUTES}–${MAX_TIMEOUT_MINUTES} minutes at run time`,
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Output variables for the Dataset node.
 *
 * Matches what `DatasetProcessor.storeOutputVariables` writes. The last three
 * are only ever written when the node waited for the embeddings — the engine
 * publishes them on the way back in from the pause
 * (`workflow-engine/nodes/dataset/embedding-wait.ts`). Advertising them for a
 * node that never waits would offer paths that resolve to nothing. Unset means
 * waiting, and a variable-bound toggle is unknowable here, so only a literal
 * `false` (or skipping embedding outright) withdraws them.
 */
export function getDatasetOutputVariables(
  data: DatasetNodeData,
  nodeId: string
): UnifiedVariable[] {
  const waits = data.waitForEmbeddings !== false && data.skipEmbedding !== true

  return [
    // Document ID
    createNestedVariable({
      nodeId,
      basePath: 'documentId',
      type: BaseType.STRING,
      label: 'Document ID',
      description: 'ID of the created document record',
    }),

    // Segment IDs array
    createNestedVariable({
      nodeId,
      basePath: 'segmentIds',
      type: BaseType.ARRAY,
      label: 'Segment IDs',
      description: 'Array of created segment IDs',
      items: {
        type: BaseType.STRING,
        label: 'Segment ID',
        description: 'ID of a document segment',
      },
    }),

    // Chunks added count
    createNestedVariable({
      nodeId,
      basePath: 'chunksAdded',
      type: BaseType.NUMBER,
      label: 'Chunks Added',
      description: 'Number of chunks successfully added',
    }),

    // Embedding status
    createNestedVariable({
      nodeId,
      basePath: 'embeddingStatus',
      type: BaseType.STRING,
      label: 'Embedding Status',
      description: waits
        ? 'Status of embedding generation: completed, failed, timeout, or skipped'
        : 'Status of embedding generation: queued or skipped (the node did not wait for the result)',
    }),

    // Dataset reference
    createNestedVariable({
      nodeId,
      basePath: 'datasetId',
      type: BaseType.STRING,
      label: 'Dataset ID',
      description: 'ID of the target dataset',
    }),

    // Success flag
    createNestedVariable({
      nodeId,
      basePath: 'success',
      type: BaseType.BOOLEAN,
      label: 'Success',
      description: 'Whether the operation succeeded',
    }),

    // Error message
    createNestedVariable({
      nodeId,
      basePath: 'error',
      type: BaseType.STRING,
      label: 'Error',
      description: 'Error message if operation failed (null if successful)',
    }),

    // Wait-only results, published when the workflow resumes
    ...(waits
      ? [
          createNestedVariable({
            nodeId,
            basePath: 'segmentsEmbedded',
            type: BaseType.NUMBER,
            label: 'Segments Embedded',
            description: 'Number of segments that were embedded before the wait ended',
          }),
          createNestedVariable({
            nodeId,
            basePath: 'processingTimeMs',
            type: BaseType.NUMBER,
            label: 'Processing Time (ms)',
            description: 'How long embedding generation took',
          }),
          createNestedVariable({
            nodeId,
            basePath: 'completedAt',
            type: BaseType.STRING,
            label: 'Completed At',
            description: 'ISO timestamp of when embedding generation completed',
          }),
        ]
      : []),
  ]
}

/**
 * Dataset node manifest.
 */
export const datasetManifest: NodeManifest<DatasetNodeData> = {
  id: 'dataset',
  category: NodeCategory.DATASET,
  displayName: 'Dataset',
  description: 'Add chunks to a dataset with embedding generation',
  icon: 'database',
  color: '#06b6d4',
  defaultData: datasetDefaultData,
  configSchema: datasetNodeDataSchema as unknown as z.ZodType<DatasetNodeData>,
  validate: validateDatasetConfig,
  extractVariables: extractDatasetVariables,
  resolveOutputs: getDatasetOutputVariables,
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
   * A dataset write that failed has nothing to substitute (plan 21 §16.3), so
   * `fail` or `continue` only.
   */
  errorHandling: {
    strategies: [ErrorStrategy.fail, ErrorStrategy.continue],
    defaultStrategy: ErrorStrategy.fail,
  },
  agent: {
    authorable: true,
    usage:
      'Write chunked text into a RAG dataset as one document, then embed it. `datasetId` is ' +
      'required and normally a constant picked from the org’s datasets. `chunks` is required ' +
      'and must reference a Chunker node’s `chunks` output — it is an array of chunk objects, ' +
      'not text. `waitForEmbeddings` defaults to true and is what makes a later ' +
      'knowledge-retrieval node in the SAME run able to see this document; turning it off ' +
      'reports success while the dataset still holds no vectors. The wait is bounded by ' +
      '`embeddingTimeoutMinutes` (1–120, clamped). ' +
      '`error_strategy` is fail (the default — exposes a wirable "fail" branch handle; ' +
      'leaving it unwired just means the run dies, which is the normal shape) or continue ' +
      '(succeed on "source" with `success: false` and the error in the output).',
    examples: [
      {
        description: 'Store an extracted, chunked document and wait for its embeddings',
        config: {
          datasetId: 'ds_abc123',
          chunks: '{{chunker_1.chunks}}',
          documentTitle: '{{extractor_1.metadata.fileName}}',
          waitForEmbeddings: true,
        },
      },
      {
        description: 'Fire-and-forget ingest — nothing downstream reads the dataset this run',
        config: {
          datasetId: 'ds_abc123',
          chunks: '{{chunker_1.chunks}}',
          waitForEmbeddings: false,
        },
      },
    ],
  },
}
