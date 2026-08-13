// apps/web/src/components/workflow/nodes/core/list/schema.ts

import { listManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { ListNodeData } from './types'

// The data half (operation vocabulary, config types, zod schemas, defaults,
// validator, variable extraction, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/list`). This file is the merge
// site: manifest + the React parts.

/** List node definition */
export const listNodeDefinition: NodeDefinition<ListNodeData> = defineFromManifest(
  listManifest as unknown as NodeManifest<ListNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export { listNodeDataSchema, validateListNodeData } from '@auxx/lib/workflow-engine/client'

/** Factory function to create default data */
export const createListDefaultData = (): Partial<ListNodeData> =>
  listManifest.defaultData() as Partial<ListNodeData>
