// packages/lib/src/workflow-engine/catalog/nodes/document-extractor.ts

import { z } from 'zod'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createNestedVariable } from '../variable-conversion'
import { extractFieldVariableIds, isVariableMode } from '../variable-inference'

/**
 * The document-extractor node's catalog manifest.
 *
 * The data half (source-type enum, data interface, zod schema, defaults,
 * validator, variable extraction, output resolver) lives here as the single
 * source; apps/web `core/document-extractor/schema.ts` merges it with the React
 * parts via `defineFromManifest`, and
 * `core/document-extractor/output-variables.ts` re-exports
 * {@link getDocumentExtractorOutputVariables} so the builder picker and the
 * server resolver cannot produce different variable trees.
 *
 * Engine note: the processor
 * (`workflow-engine/nodes/dataset/document-extractor.ts`) keeps its own
 * runtime-facing zod schema, because it must also accept the *resolved* shapes
 * variable binding produces. It imports {@link DocumentSourceType} from here
 * rather than re-declaring it — the enum was duplicated in both files before
 * the migration.
 */

/**
 * Source type for document extraction.
 */
export enum DocumentSourceType {
  FILE = 'file',
  URL = 'url',
}

/**
 * The extractor names the processor reports in `metadata.extractorUsed`.
 * Declared here so the output resolver and the trace renderer read one list.
 */
export const DOCUMENT_EXTRACTOR_NAMES = [
  'pdf-extractor',
  'docx-extractor',
  'html-extractor',
  'text-extractor',
] as const

/**
 * Document Extractor node data interface.
 */
export interface DocumentExtractorNodeData extends BaseNodeData {
  /** Short description */
  desc?: string

  /** Source type — file or url */
  sourceType: DocumentSourceType
  /** MediaAsset ID when sourceType is 'file' (VarEditor value) */
  fileId?: string
  /** URL when sourceType is 'url' (VarEditor value) */
  url?: string

  /** Preserve document formatting in extracted text. A string when bound to a variable. */
  preserveFormatting?: boolean | string
  /** Extract image descriptions using OCR/AI. A string when bound to a variable. */
  extractImages?: boolean | string
  /** Language hint for OCR (e.g. 'en', 'es') */
  language?: string

  /** Track constant/variable mode per field */
  fieldModes?: Record<string, boolean>
}

/**
 * Zod schema for Document Extractor node data.
 *
 * The extraction toggles accept the variable reference string the panel stores
 * in variable mode alongside their literal type — a bare `z.boolean()` would
 * reject the reference before it is ever looked up. The reference is resolved
 * and coerced in the processor.
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
  preserveFormatting: z.union([z.boolean(), z.string()]).optional(),
  extractImages: z.union([z.boolean(), z.string()]).optional(),
  language: z.string().optional(),

  // Field modes
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Default configuration for new Document Extractor nodes.
 */
export const documentExtractorDefaultData = (): Partial<DocumentExtractorNodeData> => ({
  title: 'Document Extractor',
  desc: 'Extract text content from files or URLs',
  sourceType: DocumentSourceType.FILE,
  preserveFormatting: false,
  extractImages: false,
  fieldModes: {},
})

/**
 * Extract variable references from a Document Extractor configuration.
 *
 * Moved verbatim from apps/web `core/document-extractor/schema.ts`. Only the
 * source field matching the CURRENT `sourceType` contributes — the other one is
 * dead config the processor never reads.
 */
export function extractDocumentExtractorVariables(
  data: Partial<DocumentExtractorNodeData>
): string[] {
  const variableIds = new Set<string>()
  const fieldModes = data.fieldModes

  // Extract from fileId (for file source type)
  if (data.sourceType === DocumentSourceType.FILE && data.fileId) {
    if (isVariableMode(fieldModes, 'fileId')) {
      extractFieldVariableIds(data.fileId).forEach((id) => variableIds.add(id))
    }
  }

  // Extract from url (for URL source type — may contain variable references)
  if (data.sourceType === DocumentSourceType.URL && data.url) {
    if (isVariableMode(fieldModes, 'url')) {
      extractFieldVariableIds(data.url).forEach((id) => variableIds.add(id))
    }
  }

  // Extract from language (string field that could contain variables)
  if (data.language && isVariableMode(fieldModes, 'language')) {
    extractFieldVariableIds(data.language).forEach((id) => variableIds.add(id))
  }

  // Extract from the extraction toggles bound to a variable
  for (const field of ['preserveFormatting', 'extractImages'] as const) {
    const value = data[field]
    if (isVariableMode(fieldModes, field)) {
      extractFieldVariableIds(value).forEach((id) => variableIds.add(id))
    }
  }

  return Array.from(variableIds)
}

/**
 * Is this `url` a plain literal the validator may check the scheme of?
 *
 * Uses an explicit `=== false` for "bound to a variable", matching what the
 * PANEL writes (`fieldModes['url'] = isConstantMode`, defaulting to constant)
 * — NOT the {@link isVariableMode} helper, whose default is inverted and which
 * would make every untouched node skip the check.
 */
function isLiteralUrl(url: string, fieldModes: Record<string, boolean> | undefined): boolean {
  return fieldModes?.url !== false && !url.includes('{{')
}

/**
 * Validation for Document Extractor configuration.
 *
 * NEW with the catalog migration — apps/web's `documentExtractorDefinition`
 * carried no `validator` at all, so a node with neither a file nor a URL passed
 * the builder checklist and then threw at run time ("File ID is required when
 * source type is \"file\"", `nodes/dataset/document-extractor.ts`). These checks
 * mirror exactly what the processor hard-requires — nothing more, so a graph
 * that runs today still publishes.
 */
export function validateDocumentExtractorConfig(
  data: DocumentExtractorNodeData
): NodeValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  if (data.sourceType === DocumentSourceType.URL) {
    if (!data.url?.trim()) {
      errors.push({ field: 'url', message: 'A URL is required', type: 'error' })
    } else if (isLiteralUrl(data.url, data.fieldModes)) {
      // Only a LITERAL url can be checked here. A bound field, or a constant
      // carrying a `{{…}}` template, holds a value that is not known until the
      // run — the processor re-checks the scheme against the RESOLVED value.
      if (!data.url.startsWith('http://') && !data.url.startsWith('https://')) {
        errors.push({
          field: 'url',
          message: 'URL must start with http:// or https://',
          type: 'error',
        })
      }
    }
  } else if (!data.fileId?.trim()) {
    errors.push({ field: 'fileId', message: 'A file is required', type: 'error' })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/** Shape of one entry in the metadata object exposed to downstream nodes. */
type MetadataProperty = {
  type: BaseType
  label?: string
  description?: string
  enum?: (string | number)[]
}

/**
 * Output variables for the Document Extractor node.
 *
 * Matches what `DocumentExtractorProcessor.storeOutputVariables` writes. The
 * `metadata` properties differ by `sourceType` — a file run has no `sourceUrl`
 * and a URL run has no `fileSize`, so advertising both sets would offer paths
 * that resolve to nothing.
 */
export function getDocumentExtractorOutputVariables(
  data: DocumentExtractorNodeData,
  nodeId: string
): UnifiedVariable[] {
  const isFileSource = data.sourceType === DocumentSourceType.FILE
  const extractorEnum = [...DOCUMENT_EXTRACTOR_NAMES]

  const metadataProperties: Record<string, MetadataProperty> = isFileSource
    ? {
        fileName: {
          type: BaseType.STRING,
          label: 'File Name',
          description: 'Name of the extracted file',
        },
        mimeType: {
          type: BaseType.STRING,
          label: 'MIME Type',
          description: 'MIME type of the document',
        },
        fileSize: {
          type: BaseType.NUMBER,
          label: 'File Size',
          description: 'Size of the file in bytes',
        },
        extractorUsed: {
          type: BaseType.STRING,
          label: 'Extractor Used',
          description: 'Name of the extractor that processed the document',
          enum: extractorEnum,
        },
      }
    : {
        sourceUrl: {
          type: BaseType.STRING,
          label: 'Source URL',
          description: 'URL the document was fetched from',
        },
        fileName: {
          type: BaseType.STRING,
          label: 'File Name',
          description: 'Name derived from URL',
        },
        mimeType: {
          type: BaseType.STRING,
          label: 'MIME Type',
          description: 'MIME type of the document',
        },
        contentLength: {
          type: BaseType.NUMBER,
          label: 'Content Length',
          description: 'Length of the fetched content in bytes',
        },
        extractorUsed: {
          type: BaseType.STRING,
          label: 'Extractor Used',
          description: 'Name of the extractor that processed the document',
          enum: extractorEnum,
        },
      }

  return [
    createNestedVariable({
      nodeId,
      basePath: 'content',
      type: BaseType.STRING,
      label: 'Content',
      description: 'The extracted text content from the document',
    }),

    createNestedVariable({
      nodeId,
      basePath: 'wordCount',
      type: BaseType.NUMBER,
      label: 'Word Count',
      description: 'Number of words in the extracted content',
    }),

    createNestedVariable({
      nodeId,
      basePath: 'metadata',
      type: BaseType.OBJECT,
      label: 'Metadata',
      description: 'Extraction metadata',
      properties: metadataProperties,
    }),

    createNestedVariable({
      nodeId,
      basePath: 'success',
      type: BaseType.BOOLEAN,
      label: 'Success',
      description: 'Whether the extraction succeeded',
    }),

    createNestedVariable({
      nodeId,
      basePath: 'error',
      type: BaseType.STRING,
      label: 'Error',
      description: 'Error message if extraction failed (null if successful)',
    }),
  ]
}

/**
 * Document Extractor node manifest.
 */
export const documentExtractorManifest: NodeManifest<DocumentExtractorNodeData> = {
  id: 'document-extractor',
  category: NodeCategory.DATASET,
  displayName: 'Document Extractor',
  description: 'Extract text content from files or URLs',
  icon: 'file-text',
  color: '#06b6d4',
  defaultData: documentExtractorDefaultData,
  configSchema: documentExtractorNodeDataSchema as unknown as z.ZodType<DocumentExtractorNodeData>,
  validate: validateDocumentExtractorConfig,
  extractVariables: extractDocumentExtractorVariables,
  resolveOutputs: getDocumentExtractorOutputVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Pull plain text out of a PDF/DOCX/HTML/text document. `sourceType` is "file" (needs ' +
      '`fileId`, a MediaAsset id — normally an upstream variable such as an attachment) or ' +
      '"url" (needs `url`, which must start with http:// or https://). The `metadata` output ' +
      'differs between the two: a file run exposes `fileSize`, a URL run exposes `sourceUrl` ' +
      'and `contentLength`. Feed `content` into a Chunker node.',
    examples: [
      {
        description: 'Extract an uploaded attachment',
        config: { sourceType: 'file', fileId: '{{trigger_1.file.id}}' },
      },
      {
        description: 'Extract a public web page',
        config: { sourceType: 'url', url: 'https://example.com/handbook.pdf' },
      },
    ],
  },
}
