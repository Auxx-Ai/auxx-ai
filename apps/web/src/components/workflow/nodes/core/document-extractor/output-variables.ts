// apps/web/src/components/workflow/nodes/core/document-extractor/output-variables.ts

import type { UnifiedVariable } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import { createNestedVariable } from '~/components/workflow/utils/variable-conversion'
import { type DocumentExtractorNodeData, DocumentSourceType } from './types'

/**
 * Generate output variables for Document Extractor node
 * Matches backend output from DocumentExtractorNodeProcessor
 * Metadata properties vary based on sourceType (file vs url)
 */
export function getDocumentExtractorOutputVariables(
  data: DocumentExtractorNodeData,
  nodeId: string
): UnifiedVariable[] {
  const isFileSource = data.sourceType === DocumentSourceType.FILE

  // Extractor enum values
  const extractorEnum = ['pdf-extractor', 'docx-extractor', 'html-extractor', 'text-extractor']

  // Build metadata properties based on source type
  const metadataProperties = isFileSource
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
