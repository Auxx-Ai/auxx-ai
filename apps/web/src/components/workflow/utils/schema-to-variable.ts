// apps/web/src/components/workflow/utils/schema-to-variable.ts

import type { WorkflowBlockField } from '~/components/workflow/types/block-types'
import type { Field, SchemaRoot } from '../ui/json-schema-types'

/**
 * JSON Schema ⇄ `UnifiedVariable` conversion moved to the node catalog
 * (`@auxx/lib/workflow-engine/catalog/schema-to-variable`, Phase 2) so
 * `information-extractor`'s `resolveOutputs` can live in its manifest;
 * re-exported here so no web import churns.
 *
 * `schemaRootToWorkflowFields` (below) stayed web-side: it types against
 * `WorkflowBlockField`/`Field`/`SchemaRoot`, which belong to the app-block
 * schema system (`apps/resolve-app-outputs.ts`), not the node catalog.
 */
export {
  extractSchemaPropertyPaths,
  generateSampleFromSchema,
  schemaRootToUnifiedVariables,
  schemaToUnifiedVariable,
  schemaTypeToBaseType,
  validateAgainstSchema,
} from '@auxx/lib/workflow-engine/client'

/**
 * Convert SchemaRoot → Record<string, WorkflowBlockField>
 *
 * One-way converter used at the output merge point. Converts the stored
 * inferredSchema (SchemaRoot) into WorkflowBlockField format so it can
 * merge with static and computed outputs before variable resolution.
 */
export function schemaRootToWorkflowFields(schema: SchemaRoot): Record<string, WorkflowBlockField> {
  const fields: Record<string, WorkflowBlockField> = {}
  const requiredSet = new Set(schema.required || [])

  for (const [key, field] of Object.entries(schema.properties || {})) {
    fields[key] = schemaFieldToWorkflowField(key, field, requiredSet.has(key))
  }

  return fields
}

function schemaFieldToWorkflowField(
  name: string,
  field: Field,
  isRequired: boolean
): WorkflowBlockField {
  const result: WorkflowBlockField = {
    name,
    label: formatLabel(name),
    type: field.type === 'object' ? 'object' : field.type === 'array' ? 'array' : field.type,
  }

  if (isRequired) result.required = true
  if (field.description) result.description = field.description

  // Enum → options (select type)
  if (field.enum && field.enum.length > 0) {
    result.options = field.enum.map((v) => String(v))
    result.type = 'select'
  }

  // Nested object → recurse
  if (field.type === 'object' && field.properties) {
    const childRequired = new Set(field.required || [])
    result.properties = {}
    for (const [k, v] of Object.entries(field.properties)) {
      result.properties[k] = schemaFieldToWorkflowField(k, v, childRequired.has(k))
    }
  }

  // Array → items
  if (field.type === 'array' && field.items) {
    result.items = schemaFieldToWorkflowField('item', field.items, false)
  }

  return result
}

function formatLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}
