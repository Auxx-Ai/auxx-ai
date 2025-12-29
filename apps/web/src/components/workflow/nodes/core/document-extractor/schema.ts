// apps/web/src/components/workflow/nodes/core/document-extractor/schema.ts

import { z } from 'zod'
import { type NodeDefinition, NodeCategory } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { type DocumentExtractorNodeData, DocumentSourceType } from './types'
import { getDocumentExtractorOutputVariables } from './output-variables'
import { DocumentExtractorPanel } from './panel'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { isNodeVariable, isVariableMode } from '~/components/workflow/utils/variable-utils'

/**
 * Zod schema for Document Extractor node data validation
 * Extends baseNodeDataSchema with extractor-specific fields
 */
export const documentExtractorNodeDataSchema = baseNodeDataSchema.extend({
  title: z.string().min(1),
  desc: z.string().optional(),
  description: z.string().optional(),

  // Source configuration
  sourceType: z.enum(DocumentSourceType).default(DocumentSourceType.FILE),
  fileId: z.string().optional(),
  url: z.string().optional(),

  // Extraction options
  preserveFormatting: z.boolean().optional().default(false),
  extractImages: z.boolean().optional().default(false),
  language: z.string().optional(),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Default configuration for new Document Extractor nodes
 */
export const documentExtractorDefaultData: Partial<DocumentExtractorNodeData> = {
  title: 'Document Extractor',
  desc: 'Extract text content from files or URLs',
  sourceType: DocumentSourceType.FILE,
  preserveFormatting: false,
  extractImages: false,
  fieldModes: {},
}

/**
 * Extract variables from Document Extractor configuration
 * Only extracts from fields that are in variable mode (fieldModes[field] !== true)
 */
export function extractDocumentExtractorVariables(
  data: Partial<DocumentExtractorNodeData>
): string[] {
  const variableIds = new Set<string>()
  const fieldModes = data.fieldModes

  // Extract from fileId (for file source type)
  if (data.sourceType === DocumentSourceType.FILE && data.fileId) {
    if (isVariableMode(fieldModes, 'fileId') && isNodeVariable(data.fileId)) {
      variableIds.add(data.fileId)
    }
  }

  // Extract from url (for URL source type - may contain variable references)
  if (data.sourceType === DocumentSourceType.URL && data.url) {
    if (isVariableMode(fieldModes, 'url')) {
      if (isNodeVariable(data.url)) {
        variableIds.add(data.url)
      } else {
        extractVarIdsFromString(data.url).forEach((id) => variableIds.add(id))
      }
    }
  }

  // Extract from language (string field that could contain variables)
  if (data.language && isVariableMode(fieldModes, 'language')) {
    if (isNodeVariable(data.language)) {
      variableIds.add(data.language)
    } else {
      extractVarIdsFromString(data.language).forEach((id) => variableIds.add(id))
    }
  }

  // Extract from preserveFormatting (could be a boolean variable reference)
  if (
    typeof data.preserveFormatting === 'string' &&
    isVariableMode(fieldModes, 'preserveFormatting') &&
    isNodeVariable(data.preserveFormatting)
  ) {
    variableIds.add(data.preserveFormatting)
  }

  // Extract from extractImages (could be a boolean variable reference)
  if (
    typeof data.extractImages === 'string' &&
    isVariableMode(fieldModes, 'extractImages') &&
    isNodeVariable(data.extractImages)
  ) {
    variableIds.add(data.extractImages)
  }

  return Array.from(variableIds)
}

/**
 * Document Extractor node definition for the workflow system
 */
export const documentExtractorDefinition: NodeDefinition<DocumentExtractorNodeData> = {
  id: NodeType.DOCUMENT_EXTRACTOR,
  category: NodeCategory.DATASET,
  displayName: 'Document Extractor',
  description: 'Extract text content from files or URLs',
  icon: 'file-text',
  color: '#06b6d4',
  canRunSingle: true,
  defaultData: documentExtractorDefaultData,
  schema: documentExtractorNodeDataSchema,
  panel: DocumentExtractorPanel,
  extractVariables: extractDocumentExtractorVariables,
  outputVariables: (data: DocumentExtractorNodeData, nodeId: string) =>
    getDocumentExtractorOutputVariables(data, nodeId),
}
