// apps/web/src/components/workflow/nodes/core/document-extractor/schema.ts

import { documentExtractorManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { DocumentExtractorNodeData } from './types'

// The data half (source-type enum, zod schema, defaults, validator, variable
// extraction, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/document-extractor`). This file is
// the merge site: manifest + the React parts.

/**
 * Document Extractor node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity). `component` / `panel` / `traceRenderer` are attached in
 * `nodes/core/index.ts`, as for every other migrated node.
 */
export const documentExtractorDefinition: NodeDefinition<DocumentExtractorNodeData> =
  defineFromManifest(
    documentExtractorManifest as unknown as NodeManifest<DocumentExtractorNodeData>,
    {}
  )

// Back-compat re-exports so no panel or consumer import churns:
export {
  documentExtractorNodeDataSchema,
  extractDocumentExtractorVariables,
  validateDocumentExtractorConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new Document Extractor nodes
 */
export const documentExtractorDefaultData =
  documentExtractorManifest.defaultData() as Partial<DocumentExtractorNodeData>
