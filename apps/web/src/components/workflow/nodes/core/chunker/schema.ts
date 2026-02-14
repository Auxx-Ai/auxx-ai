// apps/web/src/components/workflow/nodes/core/chunker/schema.ts

import { z } from 'zod'
import {
  NodeCategory,
  type NodeDefinition,
  type ValidationResult,
} from '~/components/workflow/types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { isNodeVariable, isVariableMode } from '~/components/workflow/utils/variable-utils'
import { getChunkerOutputVariables } from './output-variables'
import { ChunkerPanel } from './panel'
import type { ChunkerNodeData } from './types'

/**
 * Zod schema for Chunker node data validation
 * Extends baseNodeDataSchema with chunker-specific fields
 */
export const chunkerNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),

  // Input content
  content: z.string().optional(),

  // Chunking configuration
  chunkSize: z.number().positive().optional().default(1000),
  chunkOverlap: z.number().nonnegative().optional().default(50),
  delimiter: z.string().optional().default('\\n\\n'),
  normalizeWhitespace: z.boolean().optional().default(true),
  removeUrlsAndEmails: z.boolean().optional().default(false),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Default configuration for new Chunker nodes
 */
export const chunkerDefaultData: Partial<ChunkerNodeData> = {
  title: 'Chunker',
  desc: 'Split text into chunks',
  chunkSize: 1000,
  chunkOverlap: 50,
  delimiter: '\\n\\n',
  normalizeWhitespace: true,
  removeUrlsAndEmails: false,
  fieldModes: {},
}

/**
 * Extract variables from Chunker configuration
 * Only extracts from fields that are in variable mode (fieldModes[field] !== true)
 */
export function extractChunkerVariables(data: Partial<ChunkerNodeData>): string[] {
  const variableIds = new Set<string>()
  const fieldModes = data.fieldModes

  // Extract from content
  if (data.content && isVariableMode(fieldModes, 'content')) {
    if (isNodeVariable(data.content)) {
      variableIds.add(data.content)
    } else {
      extractVarIdsFromString(data.content).forEach((id) => variableIds.add(id))
    }
  }

  // Extract from delimiter
  if (data.delimiter && isVariableMode(fieldModes, 'delimiter')) {
    if (isNodeVariable(data.delimiter)) {
      variableIds.add(data.delimiter)
    } else {
      extractVarIdsFromString(data.delimiter).forEach((id) => variableIds.add(id))
    }
  }

  // Extract from chunkSize (could be a number variable reference)
  if (
    typeof data.chunkSize === 'string' &&
    isVariableMode(fieldModes, 'chunkSize') &&
    isNodeVariable(data.chunkSize)
  ) {
    variableIds.add(data.chunkSize)
  }

  // Extract from chunkOverlap (could be a number variable reference)
  if (
    typeof data.chunkOverlap === 'string' &&
    isVariableMode(fieldModes, 'chunkOverlap') &&
    isNodeVariable(data.chunkOverlap)
  ) {
    variableIds.add(data.chunkOverlap)
  }

  // Extract from normalizeWhitespace (could be a boolean variable reference)
  if (
    typeof data.normalizeWhitespace === 'string' &&
    isVariableMode(fieldModes, 'normalizeWhitespace') &&
    isNodeVariable(data.normalizeWhitespace)
  ) {
    variableIds.add(data.normalizeWhitespace)
  }

  // Extract from removeUrlsAndEmails (could be a boolean variable reference)
  if (
    typeof data.removeUrlsAndEmails === 'string' &&
    isVariableMode(fieldModes, 'removeUrlsAndEmails') &&
    isNodeVariable(data.removeUrlsAndEmails)
  ) {
    variableIds.add(data.removeUrlsAndEmails)
  }

  return Array.from(variableIds)
}

/**
 * Validate chunker node configuration
 */
export function validateChunkerConfig(data: ChunkerNodeData): ValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate content is provided
  if (!data.content?.trim()) {
    errors.push({
      field: 'content',
      message: 'Content is required for chunking',
      type: 'error',
    })
  }

  // Validate chunk size and overlap relationship (if both are numbers)
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
 * Chunker node definition for the workflow system
 */
export const chunkerDefinition: NodeDefinition<ChunkerNodeData> = {
  id: NodeType.CHUNKER,
  category: NodeCategory.DATASET,
  displayName: 'Chunker',
  description: 'Split text content into chunks',
  icon: 'scissors',
  color: '#06b6d4',
  canRunSingle: true,
  defaultData: chunkerDefaultData,
  schema: chunkerNodeDataSchema,
  panel: ChunkerPanel,
  validator: validateChunkerConfig,
  extractVariables: extractChunkerVariables,
  outputVariables: (data: ChunkerNodeData, nodeId: string) =>
    getChunkerOutputVariables(data, nodeId),
}
