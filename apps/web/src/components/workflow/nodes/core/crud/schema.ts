// apps/web/src/components/workflow/nodes/core/crud/schema.ts

import {
  crudManifest,
  crudNodeDataSchema,
  type NodeManifest,
} from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { CrudNodeData } from './types'

// The data half (data interface, zod schema, defaults, validator, variable
// extractor, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/crud`). This file is the merge
// site: manifest + the React parts.

/**
 * Zod schema for CRUD node validation
 */
export const crudSchema = crudNodeDataSchema

/**
 * CRUD node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity).
 */
export const crudDefinition: NodeDefinition<CrudNodeData> = defineFromManifest(
  crudManifest as unknown as NodeManifest<CrudNodeData>,
  {}
)

// Back-compat re-exports so no panel or consumer import churns:
export { extractCrudVariables, validateCrudNodeConfig } from '@auxx/lib/workflow-engine/client'
