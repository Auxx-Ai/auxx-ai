// apps/web/src/components/workflow/nodes/core/text-classifier/types.ts

import type { CatalogTextClassifierNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'
import { AiModelMode } from '../ai/types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/text-classifier`); re-exported
// here under the historical local names so no web import churns.
// TextClassifierNodeData narrows `type` to the web NodeType enum.
export type {
  ClassificationResult,
  TextClassifierCategory as Category,
  TextClassifierCompletionParams as CompletionParams,
  TextClassifierInstructionConfig as InstructionConfig,
  TextClassifierModelConfig as ModelConfig,
  TextClassifierOutputMode,
  TextClassifierVisionConfig as VisionConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Model mode enum. Re-exported from the AI node rather than redeclared —
 * TS enums are nominal, so a second `enum AiModelMode` with identical members
 * is a *different, incompatible* type at every boundary the two nodes share.
 */
export { AiModelMode }

/**
 * Text Classifier node data interface - flattened structure
 */
export interface TextClassifierNodeData extends CatalogTextClassifierNodeData {
  type: NodeType
}

/**
 * Full Text Classifier node type for React Flow
 */
export type TextClassifierNode = SpecificNode<'text-classifier', TextClassifierNodeData>
