// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/schema.ts

import { z } from 'zod'
import { NodeCategory, type NodeDefinition } from '~/components/workflow/types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { isNodeVariable, isVariableMode } from '~/components/workflow/utils/variable-utils'
import { getKnowledgeRetrievalOutputVariables } from './output-variables'
import type { KnowledgeRetrievalNodeData } from './types'

/**
 * Dataset entry schema
 */
const datasetEntrySchema = z.object({
  datasetId: z.string(),
})

/**
 * Zod schema for Knowledge Retrieval node data validation
 */
export const knowledgeRetrievalNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),

  // Query input
  query: z.string().optional(),

  // Dataset selection
  datasets: z.array(datasetEntrySchema).optional(),

  // Search configuration
  searchType: z.enum(['vector', 'text', 'hybrid']).optional().default('hybrid'),
  limit: z.number().min(1).max(100).optional().default(20),
  similarityThreshold: z.number().min(0).max(1).optional().default(0.7),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Default configuration for new Knowledge Retrieval nodes
 */
export const knowledgeRetrievalDefaultData: Partial<KnowledgeRetrievalNodeData> = {
  title: 'Knowledge Retrieval',
  desc: 'Search datasets for relevant content',
  searchType: 'hybrid',
  limit: 20,
  similarityThreshold: 0.7,
  datasets: [],
  fieldModes: {
    query: false, // Default to variable mode for query
    searchType: true, // Default to constant mode
    limit: true,
    similarityThreshold: true,
  },
}

/**
 * Extract variables from Knowledge Retrieval configuration
 */
export function extractKnowledgeRetrievalVariables(
  data: Partial<KnowledgeRetrievalNodeData>
): string[] {
  const variableIds = new Set<string>()
  const fieldModes = data.fieldModes

  // Extract from query (if in variable mode)
  if (data.query && isVariableMode(fieldModes, 'query')) {
    if (isNodeVariable(data.query)) {
      variableIds.add(data.query)
    } else {
      extractVarIdsFromString(data.query).forEach((id) => variableIds.add(id))
    }
  }

  // Extract from datasets (each entry can be a variable)
  if (data.datasets && Array.isArray(data.datasets)) {
    data.datasets.forEach((entry, index) => {
      const fieldKey = `datasets.${index}.datasetId`
      if (entry.datasetId && isVariableMode(fieldModes, fieldKey)) {
        if (isNodeVariable(entry.datasetId)) {
          variableIds.add(entry.datasetId)
        } else {
          extractVarIdsFromString(entry.datasetId).forEach((id) => variableIds.add(id))
        }
      }
    })
  }

  // Extract from limit (if in variable mode)
  if (data.limit !== undefined && isVariableMode(fieldModes, 'limit')) {
    const limitStr = String(data.limit)
    if (isNodeVariable(limitStr)) {
      variableIds.add(limitStr)
    }
  }

  // Extract from similarityThreshold (if in variable mode)
  if (data.similarityThreshold !== undefined && isVariableMode(fieldModes, 'similarityThreshold')) {
    const thresholdStr = String(data.similarityThreshold)
    if (isNodeVariable(thresholdStr)) {
      variableIds.add(thresholdStr)
    }
  }

  return Array.from(variableIds)
}

/**
 * Knowledge Retrieval node definition for the workflow system
 */
export const knowledgeRetrievalDefinition: NodeDefinition<KnowledgeRetrievalNodeData> = {
  id: NodeType.KNOWLEDGE_RETRIEVAL,
  category: NodeCategory.DATASET,
  displayName: 'Knowledge Retrieval',
  description: 'Search datasets for relevant content using vector, text, or hybrid search',
  icon: 'search',
  color: '#06b6d4',
  canRunSingle: true,
  defaultData: knowledgeRetrievalDefaultData,
  schema: knowledgeRetrievalNodeDataSchema,
  extractVariables: extractKnowledgeRetrievalVariables,
  outputVariables: (data: KnowledgeRetrievalNodeData, nodeId: string) =>
    getKnowledgeRetrievalOutputVariables(data, nodeId),
}
