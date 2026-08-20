// packages/lib/src/workflow-engine/catalog/nodes/chunker.ts

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
 * The chunker node's catalog manifest.
 *
 * The data half (data interface, zod schema, defaults, validator, variable
 * extraction, output resolver) lives here as the single source; apps/web
 * `core/chunker/schema.ts` merges it with the React parts via
 * `defineFromManifest`, and `core/chunker/output-variables.ts` re-exports
 * {@link getChunkerOutputVariables} so the builder picker and the server
 * resolver cannot produce different variable trees.
 *
 * Engine note: the processor (`workflow-engine/nodes/dataset/chunker.ts`) keeps
 * its own runtime-facing zod schema, because it must also accept the *resolved*
 * shapes variable binding produces. This manifest describes the PERSISTED
 * builder config.
 */

/**
 * Default chunk size in characters when the field is unset.
 * Mirrors `DEFAULT_CHUNK_SIZE` in the engine processor — both must move together.
 */
export const CHUNKER_DEFAULT_CHUNK_SIZE = 1000

/**
 * Default overlap between adjacent chunks in characters when the field is unset.
 * Mirrors `DEFAULT_CHUNK_OVERLAP` in the engine processor.
 */
export const CHUNKER_DEFAULT_CHUNK_OVERLAP = 50

/** Default split delimiter, stored ESCAPED — the engine interprets it at run time. */
export const CHUNKER_DEFAULT_DELIMITER = '\\n\\n'

/**
 * Chunker node data interface.
 */
export interface ChunkerNodeData extends BaseNodeData {
  /** Short description */
  desc?: string

  /** The text content to chunk — typically from Document Extractor output */
  content?: string

  /**
   * Maximum chunk size in characters (default {@link CHUNKER_DEFAULT_CHUNK_SIZE}).
   * A string when bound to a variable.
   */
  chunkSize?: number | string
  /**
   * Overlap between chunks in characters (default
   * {@link CHUNKER_DEFAULT_CHUNK_OVERLAP}). A string when bound to a variable.
   */
  chunkOverlap?: number | string
  /**
   * Custom delimiter for splitting, stored escaped (e.g. `'\\n\\n'`) — the
   * engine runs it through `interpretEscapeSequences`.
   */
  delimiter?: string
  /** Replace consecutive spaces/newlines (default true). A string when bound to a variable. */
  normalizeWhitespace?: boolean | string
  /** Remove URLs and email addresses (default false). A string when bound to a variable. */
  removeUrlsAndEmails?: boolean | string

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
 * Zod schema for Chunker node data.
 *
 * Bindable fields accept the variable reference string the panel stores in
 * variable mode alongside their literal type — a bare `z.number()` /
 * `z.boolean()` would reject the reference before it is ever looked up. Ranges
 * are enforced against the RESOLVED value in the processor.
 */
export const chunkerNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),

  // Input content
  content: z.string().optional(),

  // Chunking configuration
  chunkSize: z.union([z.number().positive(), z.string()]).optional(),
  chunkOverlap: z.union([z.number().nonnegative(), z.string()]).optional(),
  delimiter: z.string().optional().default(CHUNKER_DEFAULT_DELIMITER),
  normalizeWhitespace: z.union([z.boolean(), z.string()]).optional(),
  removeUrlsAndEmails: z.union([z.boolean(), z.string()]).optional(),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),

  // Failure policy — see `catalog/error-handling.ts`.
  error_strategy: errorStrategySchema.optional(),
})

/**
 * Default configuration for new Chunker nodes.
 */
export const chunkerDefaultData = (): Partial<ChunkerNodeData> => ({
  title: 'Chunker',
  desc: 'Split text into chunks',
  chunkSize: CHUNKER_DEFAULT_CHUNK_SIZE,
  chunkOverlap: CHUNKER_DEFAULT_CHUNK_OVERLAP,
  delimiter: CHUNKER_DEFAULT_DELIMITER,
  normalizeWhitespace: true,
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
  removeUrlsAndEmails: false,
  fieldModes: {},
})

/**
 * Extract variable references from a Chunker configuration.
 *
 * Moved verbatim from apps/web `core/chunker/schema.ts`. Only fields in
 * variable mode contribute (`isVariableMode` is `fieldModes[field] !== true`,
 * i.e. variable mode is the default).
 */
export function extractChunkerVariables(data: Partial<ChunkerNodeData>): string[] {
  const variableIds = new Set<string>()
  const fieldModes = data.fieldModes

  // Extract from content
  if (data.content && isVariableMode(fieldModes, 'content')) {
    extractFieldVariableIds(data.content).forEach((id) => variableIds.add(id))
  }

  // Extract from delimiter
  if (data.delimiter && isVariableMode(fieldModes, 'delimiter')) {
    extractFieldVariableIds(data.delimiter).forEach((id) => variableIds.add(id))
  }

  // Extract from the numeric/boolean settings — each holds a reference string
  // when bound through the picker
  for (const field of [
    'chunkSize',
    'chunkOverlap',
    'normalizeWhitespace',
    'removeUrlsAndEmails',
  ] as const) {
    const value = data[field]
    if (isVariableMode(fieldModes, field)) {
      extractFieldVariableIds(value).forEach((id) => variableIds.add(id))
    }
  }

  return Array.from(variableIds)
}

/**
 * Validation for Chunker configuration.
 *
 * Moved verbatim from apps/web, severities included. Note the overlap warning:
 * the engine's `preprocessNode` THROWS on the same condition
 * (`chunker.ts` — "Overlap too large: effective step …"), so a workflow that
 * publishes with only this warning still fails at run time. Raising it to an
 * error would newly block publishing, which is its own decision — see the PR
 * body for #1644's follow-up slice.
 */
export function validateChunkerConfig(data: ChunkerNodeData): NodeValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate content is provided
  if (!data.content?.trim()) {
    errors.push({
      field: 'content',
      message: 'Content is required for chunking',
      type: 'error',
    })
  }

  // Validate chunk size and overlap relationship (literal values only — a bound
  // field holds a reference whose value is not known until the run)
  const chunkSize = typeof data.chunkSize === 'number' ? data.chunkSize : undefined
  const chunkOverlap = typeof data.chunkOverlap === 'number' ? data.chunkOverlap : undefined

  if (chunkSize !== undefined && chunkOverlap !== undefined) {
    if (chunkOverlap >= chunkSize) {
      errors.push({
        field: 'chunkOverlap',
        message: 'Chunk overlap must be less than chunk size',
        type: 'error',
      })
    }

    const effectiveStep = chunkSize - chunkOverlap
    if (effectiveStep < chunkSize * 0.2) {
      errors.push({
        field: 'chunkOverlap',
        message: `Overlap too large. Effective step (${effectiveStep}) should be at least 20% of chunk size.`,
        type: 'warning',
      })
    }
  }

  // Warning for very large chunk sizes
  if (chunkSize !== undefined && chunkSize > 8000) {
    errors.push({
      field: 'chunkSize',
      message: 'Large chunk size may exceed token limits for some embedding models',
      type: 'warning',
    })
  }

  return {
    isValid: errors.filter((e) => e.type === 'error').length === 0,
    errors,
  }
}

/**
 * Output variables for the Chunker node.
 *
 * Matches what `ChunkerProcessor.storeOutputVariables` writes. Config-independent:
 * the processor publishes all five paths on BOTH the success and the failure
 * path, so nothing here is gated on config.
 */
export function getChunkerOutputVariables(
  _data: ChunkerNodeData,
  nodeId: string
): UnifiedVariable[] {
  return [
    // Chunks array with structured items
    createNestedVariable({
      nodeId,
      basePath: 'chunks',
      type: BaseType.ARRAY,
      label: 'Chunks',
      description: 'Array of text chunks with metadata',
      items: {
        type: BaseType.OBJECT,
        label: 'Chunk',
        description: 'A single text chunk',
        properties: {
          content: {
            type: BaseType.STRING,
            label: 'Content',
            description: 'The chunk text content',
          },
          position: {
            type: BaseType.NUMBER,
            label: 'Position',
            description: 'Index position in the chunk array (0-based)',
          },
          startOffset: {
            type: BaseType.NUMBER,
            label: 'Start Offset',
            description: 'Start position in preprocessed content',
          },
          endOffset: {
            type: BaseType.NUMBER,
            label: 'End Offset',
            description: 'End position in preprocessed content',
          },
          tokenCount: {
            type: BaseType.NUMBER,
            label: 'Token Count',
            description: 'Estimated token count for this chunk',
          },
          wordCount: {
            type: BaseType.NUMBER,
            label: 'Word Count',
            description: 'Word count for this chunk',
          },
        },
      },
    }),

    // Chunk count
    createNestedVariable({
      nodeId,
      basePath: 'chunkCount',
      type: BaseType.NUMBER,
      label: 'Chunk Count',
      description: 'Number of chunks created',
    }),

    // Metadata object with statistics
    createNestedVariable({
      nodeId,
      basePath: 'metadata',
      type: BaseType.OBJECT,
      label: 'Metadata',
      description: 'Chunking statistics',
      properties: {
        totalSegments: {
          type: BaseType.NUMBER,
          label: 'Total Segments',
          description: 'Total number of segments (same as chunk count)',
        },
        totalCharacters: {
          type: BaseType.NUMBER,
          label: 'Total Characters',
          description: 'Total characters across all chunks',
        },
        totalWords: {
          type: BaseType.NUMBER,
          label: 'Total Words',
          description: 'Total words across all chunks',
        },
        totalTokens: {
          type: BaseType.NUMBER,
          label: 'Total Tokens',
          description: 'Total estimated tokens across all chunks',
        },
        averageChunkSize: {
          type: BaseType.NUMBER,
          label: 'Average Chunk Size',
          description: 'Average chunk size in characters',
        },
        minChunkSize: {
          type: BaseType.NUMBER,
          label: 'Min Chunk Size',
          description: 'Smallest chunk size in characters',
        },
        maxChunkSize: {
          type: BaseType.NUMBER,
          label: 'Max Chunk Size',
          description: 'Largest chunk size in characters',
        },
        originalLength: {
          type: BaseType.NUMBER,
          label: 'Original Length',
          description: 'Original content length before chunking',
        },
      },
    }),

    // Success flag
    createNestedVariable({
      nodeId,
      basePath: 'success',
      type: BaseType.BOOLEAN,
      label: 'Success',
      description: 'Whether chunking succeeded',
    }),

    // Error message
    createNestedVariable({
      nodeId,
      basePath: 'error',
      type: BaseType.STRING,
      label: 'Error',
      description: 'Error message if chunking failed (null if successful)',
    }),
  ]
}

/**
 * Chunker node manifest.
 */
export const chunkerManifest: NodeManifest<ChunkerNodeData> = {
  id: 'chunker',
  category: NodeCategory.DATASET,
  displayName: 'Chunker',
  description: 'Split text content into chunks',
  icon: 'scissors',
  color: '#06b6d4',
  defaultData: chunkerDefaultData,
  configSchema: chunkerNodeDataSchema as unknown as z.ZodType<ChunkerNodeData>,
  validate: validateChunkerConfig,
  extractVariables: extractChunkerVariables,
  resolveOutputs: getChunkerOutputVariables,
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
   * Same shape as document-extractor (plan 21 §16.3): one bad input should be
   * skippable. No `default` — there is no meaningful substitute set of chunks.
   */
  errorHandling: {
    // `fail` only — the outputs are the reason this node exists (§6.5).
    strategies: [ErrorStrategy.fail],
    defaultStrategy: ErrorStrategy.fail,
  },
  agent: {
    authorable: true,
    usage:
      'Split long text into overlapping chunks before writing it to a dataset. `content` is ' +
      "required and normally references an upstream variable (a Document Extractor node's " +
      '`content`). `chunkOverlap` must be smaller than `chunkSize`, and the step between ' +
      'chunks (`chunkSize - chunkOverlap`) must stay above 20% of `chunkSize` or the run ' +
      'fails. `delimiter` is stored ESCAPED — write "\\\\n\\\\n", not a real newline. Feed ' +
      "this node's `chunks` output into a Dataset node. " +
      '`error_strategy` is fail (the default — exposes a wirable "fail" branch handle; ' +
      'leaving it unwired just means the run dies, which is the normal shape) or continue ' +
      '(succeed on "source" with `success: false` and the error in the output).',
    examples: [
      {
        description: 'Chunk an extracted document with the defaults',
        config: {
          content: '{{extractor_1.content}}',
          chunkSize: 1000,
          chunkOverlap: 50,
          delimiter: '\\n\\n',
        },
      },
      {
        description: 'Larger chunks for long-form prose, with whitespace normalisation',
        config: {
          content: '{{extractor_1.content}}',
          chunkSize: 4000,
          chunkOverlap: 400,
          normalizeWhitespace: true,
        },
      },
    ],
  },
}
