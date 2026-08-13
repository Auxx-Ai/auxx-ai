// apps/web/src/components/workflow/nodes/core/information-extractor/types.ts

import type { CatalogInformationExtractorNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types'
import type { NodeType } from '~/components/workflow/types/node-types'
import type { SchemaRoot } from '~/components/workflow/ui/json-schema-types'
import type { UnifiedVariable } from '../if-else'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/information-extractor`);
// re-exported here so no web import churns. The node data narrows `type` to
// the web NodeType enum and `structured_output.schema` to the schema editor's
// `SchemaRoot` (the catalog keeps that member loose for exactly this reason).
export type {
  InformationExtractorInstruction,
  InformationExtractorModel,
  InformationExtractorVision,
} from '@auxx/lib/workflow-engine/client'

import type { InformationExtractorModel } from '@auxx/lib/workflow-engine/client'

/**
 * Structured output configuration
 */
export interface StructuredOutputConfig {
  enabled: boolean
  schema?: SchemaRoot
}

/**
 * Node data interface - flattened structure
 */
export interface InformationExtractorNodeData extends CatalogInformationExtractorNodeData {
  type: NodeType
  structured_output: StructuredOutputConfig
}

/**
 * Full Information Extractor node type for React Flow
 */
export type InformationExtractorNode = SpecificNode<
  'information-extractor',
  InformationExtractorNodeData
>

/**
 * Context value interface for React Context
 */
export interface InformationExtractorContextValue {
  // State
  config: InformationExtractorNodeData
  availableVariables: UnifiedVariable[]
  isReadOnly: boolean
  schema: SchemaRoot | undefined

  // Actions
  updateTitle: (title: string) => void
  updateDescription: (desc: string) => void
  updateModel: (model: InformationExtractorModel) => void
  updateText: (text: string) => void
  updateStructuredOutput: (enabled: boolean, schema?: SchemaRoot) => void

  // Advanced settings
  updateVision: (enabled: boolean) => void
  updateInstruction: (enabled: boolean, text?: string) => void

  // Utilities
  getOutputVariables: () => UnifiedVariable[]
}
