// apps/web/src/components/workflow/nodes/inputs/form-input/types.ts

import type { CatalogFormInputNodeData } from '@auxx/lib/workflow-engine/client'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half (type-option shapes, zod schema, defaults, validator, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/form-input`).

/**
 * Form input node data — the catalog shape with `type` narrowed to the
 * builder's `NodeType` enum.
 */
export interface FormInputNodeData extends CatalogFormInputNodeData {
  type: NodeType
}

// Back-compat re-exports so no panel or consumer import churns:
export type {
  AddressTypeOptions,
  BooleanTypeOptions,
  CurrencyTypeOptions,
  EnumOption,
  EnumTypeOptions,
  FileTypeOptions,
  StringTypeOptions,
  TypeOptions,
} from '@auxx/lib/workflow-engine/client'
