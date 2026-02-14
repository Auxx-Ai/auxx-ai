// apps/web/src/components/workflow/nodes/core/document-extractor/index.ts

export { DocumentExtractorNode } from './node'
export { getDocumentExtractorOutputVariables } from './output-variables'
export { DocumentExtractorPanel } from './panel'
export {
  documentExtractorDefaultData,
  documentExtractorDefinition,
  documentExtractorNodeDataSchema,
  extractDocumentExtractorVariables,
} from './schema'
export type {
  DocumentExtractorNode as DocumentExtractorNodeType,
  DocumentExtractorNodeData,
} from './types'
export { DocumentSourceType } from './types'
