// apps/web/src/components/workflow/nodes/core/dataset/schema.ts

import { z } from 'zod'
import { NodeCategory, type NodeDefinition } from '~/components/workflow/types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { isNodeVariable, isVariableMode } from '~/components/workflow/utils/variable-utils'
import { getDatasetOutputVariables } from './output-variables'
import { DatasetPanel } from './panel'
import type { DatasetNodeData } from './types'

/**
 * Zod schema for Dataset node data validation
 * Extends baseNodeDataSchema with dataset-specific fields
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
  skipEmbedding: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.any()).optional(),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Default configuration for new Dataset nodes
 */
export const datasetDefaultData: Partial<DatasetNodeData> = {
  title: 'Dataset',
  desc: 'Add chunks to a dataset',
  skipEmbedding: false,
  mimeType: 'text/plain',
  fieldModes: {
    datasetId: true, // Default to constant mode for dataset picker
    chunks: false, // Default to variable mode for chunks
    documentTitle: true,
    skipEmbedding: true,
  },
}

/**
 * Extract variables from Dataset configuration
 * Only extracts from fields that are in variable mode
 */
export function extractDatasetVariables(data: Partial<DatasetNodeData>): string[] {
  const variableIds = new Set<string>()
  const fieldModes = data.fieldModes

  // Extract from datasetId (if in variable mode)
  if (data.datasetId && isVariableMode(fieldModes, 'datasetId')) {
    if (isNodeVariable(data.datasetId)) {
      variableIds.add(data.datasetId)
    } else {
      extractVarIdsFromString(data.datasetId).forEach((id) => variableIds.add(id))
    }
  }

  // Extract from chunks (typically a variable reference like "chunker.chunks")
  if (data.chunks) {
    if (isNodeVariable(data.chunks)) {
      variableIds.add(data.chunks)
    } else {
      extractVarIdsFromString(data.chunks).forEach((id) => variableIds.add(id))
    }
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
    if (isNodeVariable(data.fileId)) {
      variableIds.add(data.fileId)
    }
  }

  return Array.from(variableIds)
}

/**
 * Dataset node definition for the workflow system
 */
export const datasetDefinition: NodeDefinition<DatasetNodeData> = {
  id: NodeType.DATASET,
  category: NodeCategory.DATASET,
  displayName: 'Dataset',
  description: 'Add chunks to a dataset with embedding generation',
  icon: 'database',
  color: '#06b6d4',
  canRunSingle: true,
  defaultData: datasetDefaultData,
  schema: datasetNodeDataSchema,
  panel: DatasetPanel,
  extractVariables: extractDatasetVariables,
  outputVariables: (data: DatasetNodeData, nodeId: string) =>
    getDatasetOutputVariables(data, nodeId),
}
