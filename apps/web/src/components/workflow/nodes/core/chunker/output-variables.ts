// apps/web/src/components/workflow/nodes/core/chunker/output-variables.ts

import type { UnifiedVariable } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import { createNestedVariable } from '~/components/workflow/utils/variable-conversion'
import type { ChunkerNodeData } from './types'

/**
 * Generate output variables for Chunker node
 * Uses createNestedVariable pattern for structured array output
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
