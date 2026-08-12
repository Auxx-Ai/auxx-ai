// apps/web/src/components/workflow/nodes/core/document-extractor/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Source type for document extraction
 */
export enum DocumentSourceType {
  FILE = 'file',
  URL = 'url',
}

/**
 * Document Extractor node data interface
 */
export interface DocumentExtractorNodeData extends BaseNodeData {
  /** Node title */
  title: string
  /** Short description */
  desc?: string
  /** Full description */
  description?: string

  /** Source type - file or url */
  sourceType: DocumentSourceType
  /** MediaAsset ID when sourceType is 'file' (VarEditor value) */
  fileId?: string
  /** URL when sourceType is 'url' (VarEditor value) */
  url?: string

  /** Extraction options */
  /** Preserve document formatting in extracted text. A string when bound to a variable. */
  preserveFormatting?: boolean | string
  /** Extract image descriptions using OCR/AI. A string when bound to a variable. */
  extractImages?: boolean | string
  /** Language hint for OCR (e.g., 'en', 'es') */
  language?: string

  /** Track constant/variable mode per field */
  fieldModes?: Record<string, boolean>
}

/**
 * Specific Document Extractor node type for React Flow
 */
export type DocumentExtractorNode = SpecificNode<'document-extractor', DocumentExtractorNodeData>
