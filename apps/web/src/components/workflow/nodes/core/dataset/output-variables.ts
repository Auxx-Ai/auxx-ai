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
  _data: DatasetNodeData,
  nodeId: string
): UnifiedVariable[] {
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
      description: 'Status of embedding generation (queued/completed/skipped)',
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
  ]
}
