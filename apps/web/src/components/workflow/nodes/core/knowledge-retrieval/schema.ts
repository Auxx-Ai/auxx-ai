// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/schema.ts

import { z } from 'zod'
import { NodeCategory, type NodeDefinition } from '~/components/workflow/types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { isNodeVariable, isVariableMode } from '~/components/workflow/utils/variable-utils'
import { getKnowledgeRetrievalOutputVariables } from './output-variables'
import { type KnowledgeRetrievalNodeData, sourceFieldKey, sourceRawId } from './types'

/**
 * Knowledge source row schema — a discriminated union so a row's kind survives
 * a variable-bound id (the engine schema is widened identically).
 */
const sourceRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dataset'), datasetId: z.string() }),
  z.object({ kind: z.literal('kb'), knowledgeBaseId: z.string() }),
])

/**
 * Zod schema for Knowledge Retrieval node data validation
 *
 * Bindable search settings accept the variable reference string the panel
 * stores in variable mode alongside their literal type — the engine schema
 * (`workflow-engine/nodes/dataset/knowledge-retrieval.ts`) is widened the same
 * way.
 */
export const knowledgeRetrievalNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),

  // Query input
  query: z.string().optional(),

  // Knowledge selection — knowledge bases and/or RAG datasets
  sources: z.array(sourceRowSchema).optional(),

  // Search configuration
  searchType: z.union([z.enum(['vector', 'text', 'hybrid']), z.string()]).optional(),
  limit: z.union([z.number().min(1).max(25), z.string()]).optional(),
  similarityThreshold: z.union([z.number().min(0).max(1), z.string()]).optional(),
  dedupePerDocument: z.union([z.boolean(), z.string()]).optional(),
  recordIds: z.union([z.array(z.string()), z.string()]).optional(),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Default configuration for new Knowledge Retrieval nodes
 */
export const knowledgeRetrievalDefaultData: Partial<KnowledgeRetrievalNodeData> = {
  title: 'Knowledge Retrieval',
  desc: 'Search knowledge bases and datasets for relevant content',
  searchType: 'hybrid',
  limit: 20,
  // similarityThreshold deliberately unset (K7) — the vector lane's own 0.4
  // floor is a better default than the 0.7 this used to ship.
  // New nodes get one-passage-per-article; existing nodes keep raw segments
  // because the schema default is false.
  dedupePerDocument: true,
  sources: [],
  fieldModes: {
    query: false, // Default to variable mode for query
    searchType: true, // Default to constant mode
    limit: true,
    similarityThreshold: true,
    dedupePerDocument: true,
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

  // Extract from sources (each row's id can be a variable)
  if (data.sources && Array.isArray(data.sources)) {
    data.sources.forEach((row, index) => {
      const rawId = sourceRawId(row)
      if (rawId && isVariableMode(fieldModes, sourceFieldKey(row, index))) {
        if (isNodeVariable(rawId)) {
          variableIds.add(rawId)
        } else {
          extractVarIdsFromString(rawId).forEach((id) => variableIds.add(id))
        }
      }
    })
  }

  // Extract from searchType (if in variable mode)
  if (
    data.searchType &&
    isVariableMode(fieldModes, 'searchType') &&
    isNodeVariable(data.searchType)
  ) {
    variableIds.add(data.searchType)
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
