// apps/web/src/components/workflow/nodes/inputs/form-input/schema.ts

import { formInputManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import { FormInputPanel } from './panel'
import type { FormInputNodeData } from './types'

// The data half (zod schema, defaults, validator, dynamic icon, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/form-input`). This file is the merge
// site: manifest + the React parts.

/**
 * Form Input node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity). `component` is attached in `nodes/inputs/index.ts`.
 */
export const formInputDefinition: NodeDefinition<FormInputNodeData> = defineFromManifest(
  formInputManifest as unknown as NodeManifest<FormInputNodeData>,
  { panel: FormInputPanel }
)

// Back-compat re-exports so no panel or consumer import churns:
export {
  createFormInputDefaultData,
  formInputNodeDataSchema,
  validateFormInputData,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new Form Input nodes
 */
export const formInputDefaultData = formInputManifest.defaultData() as Partial<FormInputNodeData>
