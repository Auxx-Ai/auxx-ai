// apps/web/src/components/workflow/nodes/core/date-time/types.ts

import type { CatalogDateTimeNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '../../../types'
import type { NodeType } from '../../../types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/date-time`). The enums are
// re-exported as values so panels and constants keep working unchanged.
export {
  DateFormatType,
  DateTimeOperation,
  ParseDateFormatType,
  TimeUnit,
} from '@auxx/lib/workflow-engine/client'

/**
 * Date time node data interface - flattened structure
 */
export interface DateTimeNodeData extends CatalogDateTimeNodeData {
  type: NodeType
}

/**
 * Full Date-Time node type for React Flow
 */
export type DateTimeNode = SpecificNode<'date-time', DateTimeNodeData>

/**
 * Options for dropdowns
 */
export interface DateTimeSelectOption {
  value: string
  label: string
  description?: string
}
