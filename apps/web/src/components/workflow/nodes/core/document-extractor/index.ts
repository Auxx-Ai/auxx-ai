// apps/web/src/components/workflow/nodes/core/document-extractor/index.ts

export { DocumentExtractorPanel } from './panel'
export { DocumentExtractorNode } from './node'
export {
  documentExtractorDefinition,
  documentExtractorNodeDataSchema,
  documentExtractorDefaultData,
  extractDocumentExtractorVariables,
} from './schema'
export { DocumentSourceType } from './types'
export type {
  DocumentExtractorNodeData,
  DocumentExtractorNode as DocumentExtractorNodeType,
} from './types'
export { getDocumentExtractorOutputVariables } from './output-variables'
