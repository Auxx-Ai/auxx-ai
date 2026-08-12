// apps/web/src/components/workflow/nodes/core/dataset/output-variables.ts

import type { UnifiedVariable } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import { createNestedVariable } from '~/components/workflow/utils/variable-conversion'
import type { DatasetNodeData } from './types'

/**
 * Generate output variables for Dataset node
 * Matches backend output from DatasetNodeProcessor
 */
export function getDatasetOutputVariables(
  data: DatasetNodeData,
  nodeId: string
): UnifiedVariable[] {
  // The last three are only ever written when the node waited for the
  // embeddings — the engine publishes them on the way back in from the pause
  // (`workflow-engine/nodes/dataset/embedding-wait.ts`). Advertising them for a
  // node that never waits would offer paths that resolve to nothing.
  // Unset means waiting, and a variable-bound toggle is unknowable here, so
  // only a literal `false` (or skipping embedding outright) withdraws them.
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
