// apps/web/src/components/workflow/nodes/core/crud/schema.ts

import { NodeCategory, type NodeDefinition } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import { isNodeVariable } from '~/components/workflow/utils/variable-utils'
import { getCrudNodeOutputVariables } from './output-variables'
import { CrudPanel } from './panel'
import { type CrudNodeData, createCrudNodeDefaultData, crudNodeDataSchema } from './types'
import { validateCrudNodeConfig } from './validation'
/**
 * Zod schema for CRUD node validation
 */
export const crudSchema = crudNodeDataSchema

/**
 * Extract variables from CRUD operation data
 * Matches backend implementation in packages/lib/src/workflow-engine/nodes/action-nodes/crud.ts:129-157
 */
export function extractCrudVariables(data: Partial<CrudNodeData>): string[] {
  const variableIds = new Set<string>()

  // Extract from resourceId (for update/delete operations)
  if (isNodeVariable(data.resourceId)) {
    variableIds.add(data.resourceId!)
  }

  // Extract from field values (for create/update operations)
  if (data.data) {
    Object.values(data.data).forEach((fieldValue: any) => {
      if (typeof fieldValue === 'string') {
        // String values may contain {{variable}} patterns
        extractVarIdsFromString(fieldValue).forEach((id) => variableIds.add(id))
      } else if (fieldValue && typeof fieldValue === 'object') {
        // VarEditor format: { variable: 'nodeId.path' }
        if (fieldValue.variable) {
          variableIds.add(fieldValue.variable)
        }
        // Also check if the object contains string values with variables
        if (typeof fieldValue.value === 'string') {
          extractVarIdsFromString(fieldValue.value).forEach((id) => variableIds.add(id))
        }
      }
    })
  }
  return Array.from(variableIds)
}

/**
 * CRUD node definition for the workflow system
 */
export const crudDefinition: NodeDefinition<CrudNodeData> = {
  id: NodeType.CRUD,
  category: NodeCategory.ACTION,
  displayName: 'CRUD',
  description: 'Create, update, or delete records in the database',
  icon: 'database',
  color: '#10b981', // ACTION category color
  canRunSingle: true,
  defaultData: createCrudNodeDefaultData(),
  schema: crudNodeDataSchema,
  panel: CrudPanel,
  validator: validateCrudNodeConfig,
  extractVariables: extractCrudVariables,
  outputVariables: (data: CrudNodeData, nodeId: string, resource, allResources) =>
    getCrudNodeOutputVariables(data, nodeId, resource, allResources),
}
