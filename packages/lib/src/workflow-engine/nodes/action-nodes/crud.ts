// packages/lib/src/workflow-engine/nodes/action-nodes/crud.ts

import { database } from '@auxx/database'
import { isActorId, toActorId } from '@auxx/types/actor'
import {
  getRelatedEntityDefinitionId,
  RELATION_UPDATE_MODES,
  type RelationshipConfig,
  RelationUpdateMode,
  type RelationUpdateMode as RelationUpdateModeType,
} from '@auxx/types/custom-field'
import { isResourceFieldId, parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import {
  getInstanceId,
  isRecordId,
  normalizeToRecordIds,
  type RecordId,
  toRecordId,
} from '@auxx/types/resource'
import { isMultiRelationship } from '@auxx/utils/relationships'
import { findCachedResource, requireCachedEntityDefId } from '../../../cache'
import { FieldValueService } from '../../../field-values/field-value-service'
import { getAutomationVisibility } from '../../../permissions/visibility/automation-visibility'
import { UnifiedCrudHandler } from '../../../resources/crud'
import { CRUD_RESOURCE_CONFIGS, getCrudField } from '../../../resources/crud-definitions'
import {
  type FieldOptionItem,
  getField,
  getFieldOptionsForResource,
  isCustomResourceId,
  isEntityDefinitionType,
  isSystemResourceId,
  isValidFieldOptionValue,
  setEntityVariables,
} from '../../../resources/registry'
import type { TableId } from '../../../resources/registry/field-registry'
import { getFieldOutputKey, type ResourceField } from '../../../resources/registry/field-types'
import type { CustomResource } from '../../../resources/registry/types'
import {
  canLinkThread,
  clearPrimaryEntity,
  linkEntityToThread,
} from '../../../threads/links.service'
import { ThreadMutationService, type ThreadUpdates } from '../../../threads/thread-mutation.service'
import { UnreadService } from '../../../threads/unread-service'
import type {
  CrudNodeData as CatalogCrudNodeData,
  CrudDefaultValue,
} from '../../catalog/nodes/crud'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { BaseType, NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { createResourceReference } from '../../types/resource-reference'
import { BaseNodeProcessor } from '../base-node'
import { resolveCanonicalResource } from '../utils/canonical-resource'
import { parseRelationInput } from './relation-utils'

/**
 * Engine-side view of the CRUD node's persisted config — a `Pick` off the
 * catalog's `CrudNodeData` (imported directly, not via `client.ts`: engine
 * code never goes through the client barrel). `error_strategy` is now the
 * catalog's `CrudErrorStrategy` enum rather than a bare string union; the
 * string-literal comparisons below project it through a template literal
 * (`` `${config.error_strategy}` ``) where TS would otherwise reject the
 * enum-vs-literal comparison — no runtime behavior changes, since the enum's
 * values are the same strings the literals always were.
 *
 * Supports both system resources (contact, ticket) and custom entities (UUID/CUID format).
 */
type CrudNodeData = Pick<
  CatalogCrudNodeData,
  | 'resourceType' // System: 'contact', 'ticket' | Custom: UUID/CUID like 'f08vj083a926klhzkr2tbfvy'
  | 'mode'
  | 'resourceId' // For update/delete operations
  | 'data' // Field values
  | 'error_strategy'
  | 'default_values'
  | 'fieldUpdateModes' // Relation update mode per field
  | 'fieldUpdateModeVars' // Dynamic mode variable per field
>

/**
 * Relation update mode (what the panel's mode badge writes) → the tag operation
 * `ThreadMutationService.tagThreadsBulk` takes. `dynamic` is resolved to a
 * runtime mode in `preprocessNode` and defaults to `replace`, so it maps the same.
 */
const TAG_OPERATION_BY_UPDATE_MODE: Record<RelationUpdateModeType, 'add' | 'remove' | 'set'> = {
  [RelationUpdateMode.REPLACE]: 'set',
  [RelationUpdateMode.ADD]: 'add',
  [RelationUpdateMode.REMOVE]: 'remove',
  [RelationUpdateMode.DYNAMIC]: 'set',
}
/**
 * CRUD node processor for handling create, read, update, delete operations
 * Supports both system resources (contact, ticket) and custom entities
 */
export class CrudNodeProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.CRUD
  /**
   * Preprocess CRUD node - resolve variables and validate configuration
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as CrudNodeData

    // Resolve and extract resource ID for update/delete operations
    let resolvedResourceId: string | undefined
    if (config.resourceId) {
      resolvedResourceId = await this.extractIdFromValue(config.resourceId, contextManager)

      // Log for debugging if extraction failed
      if (config.resourceId && !resolvedResourceId) {
        contextManager.log('WARN', node.name, 'Failed to extract ID from resourceId value', {
          configResourceId: config.resourceId,
        })
      }

      // Validate that ID was extracted for update/delete operations.
      // Name the configured value in the message — the usual cause is a
      // `{{node.path}}` that does not exist on the upstream node, and without
      // the raw value the run trace gives no way to tell which path was wrong.
      if ((config.mode === 'update' || config.mode === 'delete') && !resolvedResourceId) {
        throw new Error(
          `Resource ID is required for ${config.mode} operations, but "${config.resourceId}" ` +
            'resolved to nothing. Select a valid resource, or a variable from a previous node ' +
            'that actually produces an ID.'
        )
      }
    }

    // Resolve field update modes (including dynamic variable resolution)
    const runtimeModes = RELATION_UPDATE_MODES.filter((m) => m !== RelationUpdateMode.DYNAMIC)
    const resolvedFieldUpdateModes: Record<string, RelationUpdateModeType> = {}
    if (config.fieldUpdateModes) {
      for (const [key, mode] of Object.entries(config.fieldUpdateModes)) {
        if (mode === RelationUpdateMode.DYNAMIC) {
          const modeVar = config.fieldUpdateModeVars?.[key]
          if (modeVar) {
            const resolved = await this.resolveFieldValue(modeVar, contextManager)
            const resolvedStr = String(resolved).toLowerCase()
            resolvedFieldUpdateModes[key] = (runtimeModes as readonly string[]).includes(
              resolvedStr
            )
              ? (resolvedStr as RelationUpdateModeType)
              : RelationUpdateMode.REPLACE
          } else {
            resolvedFieldUpdateModes[key] = RelationUpdateMode.REPLACE
          }
        } else {
          resolvedFieldUpdateModes[key] = mode
        }
      }
    }

    // Resolve variables in field data
    const resolvedData: Record<string, any> = {}
    if (config.data) {
      // Resolve resource fields from cache (works for all resource types)
      const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
      const resource = await findCachedResource(organizationId, config.resourceType)
      const resourceFields = resource?.fields ?? []
      const findField = (key: string) => resourceFields.find((f) => f.key === key || f.id === key)

      // Resolve all field values in parallel
      const fieldEntries = Object.entries(config.data)
      const resolvedValues = await Promise.all(
        fieldEntries.map(([_, value]) => this.resolveFieldValue(value, contextManager))
      )

      // Process resolved values
      fieldEntries.forEach(([key, _], index) => {
        const resolvedValue = resolvedValues[index]
        const field = findField(key)

        // Handle MULTI_SELECT fields with update modes (similar to multi-relation)
        if (field?.fieldType === 'MULTI_SELECT' && config.mode === 'update') {
          const updateMode = resolvedFieldUpdateModes[key] ?? RelationUpdateMode.REPLACE
          let values: string[] = []
          if (typeof resolvedValue === 'string') {
            try {
              const parsed = JSON.parse(resolvedValue)
              values = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
            } catch {
              values = resolvedValue ? [resolvedValue] : []
            }
          } else if (Array.isArray(resolvedValue)) {
            values = resolvedValue
          }
          resolvedData[key] = { values, updateMode, fieldType: 'MULTI_SELECT' }
        }
        // Handle multi-value SCALAR fields (`options.multi` on EMAIL/URL/PHONE/…) with
        // update modes — the same per-field system multi-relation and MULTI_SELECT use.
        // A scalar write on a multi field must never be a bare whole-value set: replace
        // (the locked default) stays a whole-field set of the parsed values, add/remove
        // become row-level value ops in executeEntityOperation. An empty/null resolved
        // value stays on the plain lane below, where the existing empty-string cleanup
        // makes it a no-write instead of a list wipe.
        else if (
          field?.options?.multi &&
          config.mode === 'update' &&
          resolvedValue != null &&
          resolvedValue !== ''
        ) {
          const updateMode = resolvedFieldUpdateModes[key] ?? RelationUpdateMode.REPLACE
          let values: unknown[]
          if (Array.isArray(resolvedValue)) {
            values = resolvedValue
          } else if (typeof resolvedValue === 'string') {
            // A variable may hand back a JSON-stringified array (frontend idiom shared
            // with MULTI_SELECT); a plain scalar (an email is never valid JSON) wraps.
            try {
              const parsed = JSON.parse(resolvedValue)
              values = Array.isArray(parsed) ? parsed : [parsed]
            } catch {
              values = [resolvedValue]
            }
          } else {
            values = [resolvedValue]
          }
          resolvedData[key] = { values, updateMode, fieldType: field.fieldType }
        }
        // Transform RELATION fields: extract ID and wrap with update mode
        else if (field?.type === BaseType.RELATION) {
          const isMulti = isMultiRelationship(field.relationship?.relationshipType)
          const updateMode = resolvedFieldUpdateModes[key] ?? RelationUpdateMode.REPLACE
          // Use dbColumn for system resources (e.g., thread.inboxId), field key for custom entities
          const outputKey = field.dbColumn || key
          const ids = parseRelationInput(resolvedValue)

          contextManager.log('DEBUG', node.name, 'CRUD preprocess relation field', {
            fieldKey: key,
            outputKey,
            isMulti,
            mode: config.mode,
            inputType: Array.isArray(resolvedValue) ? 'array' : typeof resolvedValue,
            parsedIds: ids,
          })

          if (isMulti && config.mode === 'update') {
            // Multi-relation update: wrap with update mode for add/remove/replace handling
            resolvedData[outputKey] = { values: ids, updateMode }
          } else if (isMulti) {
            // Multi-relation create: pass array of IDs
            resolvedData[outputKey] = ids
          } else {
            // Single-relation: take first ID
            resolvedData[outputKey] = ids[0] ?? null
          }
        } else {
          resolvedData[key] = resolvedValue
        }
      })

      // Remove empty strings from resolved data
      Object.keys(resolvedData).forEach((key) => {
        if (resolvedData[key] === '') {
          delete resolvedData[key]
        }
      })
    }
    return {
      inputs: {
        resourceType: config.resourceType,
        mode: config.mode,
        resourceId: resolvedResourceId,
        data: resolvedData,
        fieldUpdateModes: resolvedFieldUpdateModes,
      },
      metadata: {
        nodeType: 'crud',
        resourceType: config.resourceType,
        operation: config.mode,
        hasResourceId: !!resolvedResourceId,
        fieldCount: Object.keys(resolvedData).length,
        preprocessedAt: new Date().toISOString(),
      },
    }
  }

  /**
   * Resolve field value from variable reference or return as-is
   * Unlike resolveVariableValue(), this preserves object types for RELATION fields
   * Follows the Find node pattern for raw variable resolution
   * NOW ASYNC for lazy loading support
   */
  private async resolveFieldValue(
    value: any,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    // If not a string, return as-is
    if (typeof value !== 'string') {
      return value
    }

    // Check for exact variable reference: "{{path}}" with nothing else
    // Return the raw resolved value (entity object, array, etc.) instead of string-converting.
    // This is critical for relation fields where we need the entity ID, not a display name.
    const exactVarMatch = value.match(/^\{\{([^}]+)\}\}$/)
    if (exactVarMatch?.[1]) {
      const resolved = await contextManager.resolveVariablePath(exactVarMatch[1].trim())
      return resolved ?? value
    }

    // For mixed templates like "Hello {{name}}", use string interpolation
    if (value.includes('{{') && value.includes('}}')) {
      return await contextManager.interpolateVariables(value)
    }

    // Try parsing JSON strings (for RELATION fields sent from frontend)
    if (value.startsWith('{') && value.endsWith('}')) {
      try {
        return JSON.parse(value)
      } catch {
        // Not valid JSON, return as string
      }
    }

    return value
  }

  /**
   * Validate relationship field values
   * Checks that relationship fields reference compatible resource types
   * Only validates system resources - custom entities use dynamic field definitions
   */
  private async validateRelationshipFields(
    resourceType: string,
    fieldData: Record<string, any>,
    contextManager: ExecutionContextManager
  ): Promise<string[]> {
    const errors: string[] = []

    // Skip validation for custom entities - they use dynamic field definitions
    if (isCustomResourceId(resourceType)) {
      return errors
    }

    // Use Promise.all to validate all fields in parallel
    const validationPromises = Object.entries(fieldData).map(async ([fieldKey, value]) => {
      const field = getField(resourceType as TableId, fieldKey)

      if (field?.type === BaseType.RELATION && field.relationship) {
        const expectedTargetTable = getRelatedEntityDefinitionId(
          field.relationship as RelationshipConfig
        )

        // If value is a variable reference (e.g., "{{node-123.contact}}")
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          const variablePath = value.slice(2, -2).trim()
          const variable = await contextManager.getVariable(variablePath)

          // Check if variable is an object with metadata
          if (variable && typeof variable === 'object') {
            // Check fieldReference for typed field reference
            const fieldRef = (variable as any).fieldReference

            // Parse reference to get target table using typed parsing
            if (fieldRef && typeof fieldRef === 'string' && isResourceFieldId(fieldRef)) {
              const { entityDefinitionId: sourceResourceType, fieldId: sourceFieldKey } =
                parseResourceFieldId(fieldRef as ResourceFieldId)
              const sourceField = getField(sourceResourceType as TableId, sourceFieldKey)

              if (sourceField?.type === BaseType.RELATION && sourceField.relationship) {
                const actualTargetTable = getRelatedEntityDefinitionId(
                  sourceField.relationship as RelationshipConfig
                )

                // Validate target table matches
                if (actualTargetTable !== expectedTargetTable) {
                  return (
                    `Field "${field.label}" expects ${expectedTargetTable} ` +
                    `but variable references ${actualTargetTable}`
                  )
                }
              }
            }
          }
        }
      }

      return null
    })

    // Wait for all validations to complete
    const validationResults = await Promise.all(validationPromises)

    // Collect non-null errors
    validationResults.forEach((error) => {
      if (error) {
        errors.push(error)
      }
    })

    return errors
  }

  /**
   * Extract variables from CRUD operation data
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as CrudNodeData
    const variables = new Set<string>()

    // For update/delete - resource ID might be a variable
    if (config.resourceId && typeof config.resourceId === 'string') {
      this.extractVariableIds(config.resourceId).forEach((v) => variables.add(v))
    }

    // For create/update - extract from field values
    if (config.data) {
      Object.values(config.data).forEach((fieldValue: any) => {
        if (typeof fieldValue === 'string') {
          this.extractVariableIds(fieldValue).forEach((v) => variables.add(v))
        } else if (fieldValue && typeof fieldValue === 'object') {
          // VarEditor format: { variable: 'nodeId.path' }
          if (fieldValue.variable) {
            variables.add(fieldValue.variable)
          }
          // Also check if the object itself contains string values with variables
          if (typeof fieldValue.value === 'string') {
            this.extractVariableIds(fieldValue.value).forEach((v) => variables.add(v))
          }
        }
      })
    }

    return Array.from(variables)
  }

  /**
   * Validate CRUD node configuration using registry
   * Now supports both system resources and custom entities (dynamic resources)
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as CrudNodeData

    if (!config) {
      errors.push('Node configuration is required')
      return { valid: false, errors, warnings }
    }

    // Validate resource type
    if (!config.resourceType) {
      errors.push('Resource type is required')
    }

    // Validate mode
    if (!config.mode) {
      errors.push('Operation mode is required')
    } else if (!['create', 'update', 'delete'].includes(config.mode)) {
      errors.push('Operation mode must be create, update, or delete')
    }

    // Validate resource ID for update/delete operations
    if ((config.mode === 'update' || config.mode === 'delete') && !config.resourceId) {
      errors.push('Resource ID is required for update and delete operations')
    }

    // Validate that resourceType is a system resource, entity definition type, or custom entity
    const resourceType = config.resourceType
    const isSystemResource = isSystemResourceId(resourceType)
    const isEntityDef = isEntityDefinitionType(resourceType)
    const isCustomEntity = isCustomResourceId(resourceType)

    if (resourceType && !isSystemResource && !isEntityDef && !isCustomEntity) {
      errors.push(
        `Unknown resource type: ${resourceType}. Must be a system resource, entity definition type, or custom entity UUID.`
      )
      return { valid: false, errors, warnings }
    }

    // Static field validation for system resources with CRUD configs
    // Entity definition types (contact, ticket, etc.) and custom entities are validated at runtime
    if (isSystemResource) {
      const crudConfig = CRUD_RESOURCE_CONFIGS[resourceType]

      if (!crudConfig) {
        // No static config available — skip static validation, runtime will handle it
        return { valid: errors.length === 0, errors, warnings }
      }

      // Validate required fields for create using registry (system resources only)
      if (config.mode === 'create') {
        for (const field of crudConfig.requiredFields) {
          const value = config.data?.[getFieldOutputKey(field)] ?? config.data?.[field.key]
          if (!value || (typeof value === 'string' && value.trim() === '')) {
            errors.push(`${field.label} is required for creating ${resourceType}`)
          }
        }
      }

      // Validate enum values using registry (system resources only)
      if (config.data) {
        for (const [fieldKey, value] of Object.entries(config.data)) {
          if (!value) continue

          const field = getCrudField(resourceType, fieldKey)
          if (!field) continue

          if (field.type === BaseType.ENUM) {
            const isVariable = typeof value === 'string' && value.trim().startsWith('{{')
            if (!isVariable && !isValidFieldOptionValue(resourceType, fieldKey, value as string)) {
              const validValues = getFieldOptionsForResource(resourceType, fieldKey)
                .map((opt: FieldOptionItem) => opt.label)
                .join(', ')
              errors.push(`Invalid ${field.label}: "${value}". Valid values: ${validValues}`)
            }
          }
        }
      }
    }

    // Warning for delete operations
    if (config.mode === 'delete') {
      warnings.push('Delete operations are irreversible')
    }

    // Validate error strategy
    if (
      config.error_strategy &&
      !['fail', 'continue', 'default'].includes(`${config.error_strategy}`)
    ) {
      errors.push('Error strategy must be fail, continue, or default')
    }

    // Validate default values if using default strategy
    if (`${config.error_strategy}` === 'default') {
      if (!config.default_values || config.default_values.length === 0) {
        warnings.push('Default error strategy selected but no default values configured')
      } else {
        config.default_values.forEach((dv, index) => {
          if (!dv.key) {
            errors.push(`Default value ${index + 1}: key is required`)
          }
          if (!dv.type || !['string', 'number', 'boolean', 'object', 'array'].includes(dv.type)) {
            errors.push(
              `Default value ${index + 1}: type must be string, number, boolean, object, or array`
            )
          }
          if (dv.value === undefined || dv.value === null) {
            warnings.push(`Default value ${index + 1}: value is empty`)
          }
        })
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }
  /**
   * Execute the CRUD node
   *
   * IMPORTANT: This method requires preprocessing to ensure relation fields are
   * properly transformed from logical names (e.g., "contact") to database column
   * names (e.g., "contactId"). Always call preprocessNode() before executeNode().
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    // Preprocessing is REQUIRED for correct field transformation
    if (!preprocessedData?.inputs) {
      throw new Error(
        'CRUD node requires preprocessing. Ensure preprocessNode() is called before executeNode(). ' +
          'This is necessary to transform relation fields from logical names to database column names.'
      )
    }

    const resourceType = preprocessedData.inputs.resourceType
    const mode = preprocessedData.inputs.mode
    const resourceId = preprocessedData.inputs.resourceId
    const data = preprocessedData.inputs.data

    // Validate relationship types before execution
    const config = node.data as unknown as CrudNodeData
    const relationErrors = await this.validateRelationshipFields(
      config.resourceType,
      config.data,
      contextManager
    )

    if (relationErrors.length > 0) {
      throw new Error(`Invalid relationship types: ${relationErrors.join(', ')}`)
    }

    contextManager.log('INFO', node.name, `Executing ${mode} operation on ${resourceType}`, {
      resourceId,
      fieldCount: Object.keys(data).length,
    })
    try {
      // Get organization ID up front — needed for canonicalization AND the
      // resource reference below.
      const organizationId = (await contextManager.getVariable('sys.organizationId')) as string

      // Canonicalize `resourceType` to the cached resource's own id, same as
      // find.ts, so execution, error reporting and output keying all agree on
      // ONE identity regardless of which alias (id | entityType slug |
      // apiSlug) the node was configured with.
      //
      // 'thread' short-circuits BEFORE resolution: it is a static system
      // resource, not an EntityDefinition-backed one, so canonicalizing it
      // would be a no-op anyway — but keeping the guard explicit here (rather
      // than relying on resolveCanonicalResource being a no-op for it) means
      // thread's action-based path never depends on a cache lookup
      // succeeding. This lives inside the try/catch on purpose: an unknown
      // resourceType now throws from here instead of from
      // `executeCrudOperation`'s own `findCachedResource` check, but either
      // way the throw is caught below and routed through `handleCrudError`,
      // so the configured `error_strategy` is honored exactly as before.
      const canonicalResourceType =
        resourceType === 'thread'
          ? resourceType
          : (await resolveCanonicalResource(organizationId, resourceType)).id

      const result = await this.executeCrudOperation(
        canonicalResourceType,
        mode,
        resourceId,
        data,
        contextManager
      )

      // Set success variables
      contextManager.setNodeVariable(node.nodeId, 'operation', mode)
      contextManager.setNodeVariable(node.nodeId, 'resourceType', canonicalResourceType)
      contextManager.setNodeVariable(node.nodeId, 'success', true)
      contextManager.setNodeVariable(node.nodeId, 'error', null)
      // `generateCrudNodeVariablesFromFields` declares `errorDetails`
      // unconditionally for every crud mode, but only `handleCrudError` (the
      // catch branch) used to write it — a run that succeeds outright left it
      // permanently unresolvable. Write it here, next to `error`, so it
      // resolves to null on success too.
      contextManager.setNodeVariable(node.nodeId, 'errorDetails', null)

      // Delete: write the variables `generateCrudNodeVariablesFromFields` declares
      // for delete mode (`deleted`, `id`) — the operation returns exactly this shape
      // (`{ deleted: true, id: resourceId }`, see `executeCrudOperation`'s delete case).
      if (mode === 'delete') {
        contextManager.setNodeVariable(node.nodeId, 'deleted', Boolean(result.deleted))
        contextManager.setNodeVariable(node.nodeId, 'id', result.id)
      }

      // Store resource reference for create/update operations
      if (result.id && mode !== 'delete') {
        // Store commonly accessed fields directly for performance
        contextManager.setNodeVariable(node.nodeId, 'id', result.id)

        const ref = createResourceReference(canonicalResourceType, result.id, organizationId)

        // Threads are action-based, not field-based: the result is a set of action
        // flags. Every one of them is advertised as an individual output variable by
        // the builder (`nodes/core/crud/output-variables.ts`), so write them all —
        // leaving them inside `output` alone makes the picker hand out paths that
        // resolve to nothing.
        if (canonicalResourceType === 'thread') {
          contextManager.setNodeVariable(node.nodeId, 'thread', ref)
          for (const [key, value] of Object.entries(result.thread ?? {})) {
            contextManager.setNodeVariable(node.nodeId, key, value)
          }
        }
        // For entities (custom IDs and entity definition types), use setEntityVariables
        else if (
          isCustomResourceId(canonicalResourceType) ||
          isEntityDefinitionType(canonicalResourceType)
        ) {
          // Safe: `canonicalResourceType` is always `resource.id` post-resolution
          // (see `resolveCanonicalResource`), never a raw slug/apiSlug — so this
          // fallback can no longer hand `setEntityVariables` a value it rejects.
          const entityDefId = result.entityInstance?.entityDefinitionId ?? canonicalResourceType
          const entityData = {
            id: result.id,
            entityDefinitionId: entityDefId,
            createdAt: result.entityInstance?.createdAt,
            updatedAt: result.entityInstance?.updatedAt,
            fieldValues: result.fieldValues || {},
          }

          // This sets variables exactly like triggers do:
          // - nodeId.{entityDefId} (ResourceReference) - e.g., nodeId.f08vj083a926klhzkr2tbfvy
          // - nodeId.{entityDefId}.record_id, created_at, updated_at
          // - nodeId.{entityDefId}.fieldName (for each field)
          setEntityVariables(entityDefId, entityData, contextManager, node.nodeId)

          // Also store under 'record' key for convenience
          contextManager.setNodeVariable(node.nodeId, 'record', ref)
        } else {
          // Reachable only for a genuine static system resource other than
          // 'thread' (e.g. 'message', 'user') — every entity-backed
          // resourceType, whatever alias (id | entityType slug | apiSlug) it
          // was configured with, is now canonicalized to `resource.id` and
          // routed through the branch above instead of falling through here.
          contextManager.setNodeVariable(node.nodeId, canonicalResourceType, ref)

          // Store commonly accessed scalar fields directly to avoid lazy loading overhead
          const resourceData = result[canonicalResourceType] || result.entityInstance
          if (resourceData) {
            const commonFields = ['title', 'status', 'email', 'firstName', 'lastName', 'name']
            commonFields.forEach((fieldName) => {
              if (resourceData[fieldName]) {
                contextManager.setNodeVariable(node.nodeId, fieldName, resourceData[fieldName])
              }
            })
          }
        }
      }

      return {
        status: NodeRunningStatus.Succeeded,
        output: result,
        outputHandle: 'source', // Success handle
        metadata: {
          operation: mode,
          resourceType: canonicalResourceType,
          success: true,
        },
      }
    } catch (error: any) {
      const config = node.data as unknown as CrudNodeData
      const errorDetails = this.extractErrorDetails(error)

      contextManager.log('ERROR', node.name, `${mode} operation failed`, {
        error: errorDetails.dbError?.message || errorDetails.message, // Show DB error first
        dbErrorCode: errorDetails.dbError?.code,
        constraint: errorDetails.dbError?.constraint,
        column: errorDetails.dbError?.column,
        table: errorDetails.dbError?.table,
        detail: errorDetails.dbError?.detail,
        resourceType,
        resourceId,
        strategy: config.error_strategy || 'fail',
      })
      // Handle error based on strategy
      return await this.handleCrudError(
        error,
        config,
        node,
        contextManager,
        mode,
        resourceType,
        resourceId
      )
    }
  }
  /**
   * Execute CRUD operation based on resource type
   * Supports both system resources (contact, ticket) and custom entities (UUID/CUID format)
   */
  private async executeCrudOperation(
    resourceType: string,
    mode: 'create' | 'update' | 'delete',
    resourceId: string | undefined,
    data: Record<string, any>,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string

    // Thread has special behavior (read status, tags, unread service)
    if (resourceType === 'thread') {
      return await this.executeThreadOperation(mode, resourceId, data, contextManager)
    }

    // All other resource types (custom entity IDs and entity definition types like 'contact', 'ticket')
    // are entities — resolve via findCachedResource which matches by id, entityType, or apiSlug
    const resource = await findCachedResource(organizationId, resourceType)

    if (!resource) {
      throw new Error(`Unknown resource type: ${resourceType}`)
    }

    return await this.executeEntityOperation(
      resource as CustomResource,
      mode,
      resourceId,
      data,
      contextManager
    )
  }

  /**
   * Execute CRUD operations for custom entities using UnifiedCrudHandler
   */
  private async executeEntityOperation(
    resource: CustomResource,
    mode: 'create' | 'update' | 'delete',
    resourceId: string | undefined,
    data: Record<string, any>,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string

    // Map field names (keys) to database field IDs for entity operations
    const dataWithFieldIds = this.mapFieldNamesToIds(data, resource.fields)

    const handler = new UnifiedCrudHandler(organizationId, userId, database)

    switch (mode) {
      case 'create': {
        // Use the createWithValues method - handles both instance creation and field values
        const result = await handler.createWithValues(resource.entityDefinitionId, dataWithFieldIds)
        return {
          entityInstance: result.entityInstance,
          id: result.id,
          fieldValues: data, // Return original field values by name for variable resolution
        }
      }

      case 'update': {
        if (!resourceId) {
          throw new Error('Resource ID required for update operation')
        }

        // Separate mode-aware fields (relations, multi-select, multi-value scalars)
        // from regular fields
        const regularData: Record<string, any> = {}
        const modeAwareRelations: Array<{
          fieldId: string
          values: RecordId[]
          updateMode: RelationUpdateModeType
        }> = []
        const modeAwareOptions: Array<{
          fieldId: string
          values: string[]
          updateMode: RelationUpdateModeType
        }> = []

        for (const [fieldId, value] of Object.entries(dataWithFieldIds)) {
          const hasUpdateMode =
            typeof value === 'object' &&
            value !== null &&
            'updateMode' in value &&
            'values' in value

          contextManager.log('DEBUG', undefined, 'CRUD update field dispatch', {
            fieldId,
            valueType: Array.isArray(value) ? 'array' : typeof value,
            hasUpdateMode,
            isObject: typeof value === 'object' && value !== null,
            hasUpdateModeKey: typeof value === 'object' && value !== null && 'updateMode' in value,
            hasValuesKey: typeof value === 'object' && value !== null && 'values' in value,
          })

          if (hasUpdateMode) {
            const { values, updateMode, fieldType } = value as {
              values: string[]
              updateMode: RelationUpdateModeType
              fieldType?: string
            }
            const modeField = resource.fields.find((f) => f.id === fieldId || f.key === fieldId)

            if (fieldType === 'MULTI_SELECT' || modeField?.options?.multi) {
              // MULTI_SELECT or multi-value scalar (`options.multi`) with update mode:
              // add/remove route through the row-level addValues/removeValues primitives
              // (they support both kinds), replace stays a whole-field set.
              if (
                updateMode === RelationUpdateMode.ADD ||
                updateMode === RelationUpdateMode.REMOVE
              ) {
                modeAwareOptions.push({ fieldId, values, updateMode })
              } else {
                // Replace mode: pass values through to regular handler
                regularData[fieldId] = values
              }
            } else if (
              updateMode === RelationUpdateMode.ADD ||
              updateMode === RelationUpdateMode.REMOVE
            ) {
              // Relation field with add/remove mode
              // Normalize inputs (RecordIds, entity objects, ResourceReferences, plain IDs)
              // to compound RecordId[] — the field value service bulk primitives accept
              // relatedRecordIds directly and parse the instance portion internally.
              const field = resource.fields.find((f) => f.id === fieldId || f.key === fieldId)
              const relatedEntityDefId = field?.relationship
                ? getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
                : null
              const fallbackDefId = relatedEntityDefId ?? resource.entityDefinitionId
              const normalizedRecordIds = normalizeToRecordIds(values, fallbackDefId)
              modeAwareRelations.push({
                fieldId,
                values: normalizedRecordIds,
                updateMode,
              })
            } else {
              // Replace mode: normalize values to RecordId format for field value service
              const field = resource.fields.find((f) => f.id === fieldId || f.key === fieldId)
              const relatedEntityDefId = field?.relationship
                ? getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
                : null

              if (relatedEntityDefId) {
                const normalized = normalizeToRecordIds(values, relatedEntityDefId)
                contextManager.log('DEBUG', undefined, 'CRUD replace-mode relation normalized', {
                  fieldId,
                  relatedEntityDefId,
                  inputTypes: values.map((v) => (typeof v === 'object' ? 'object' : typeof v)),
                  outputRecordIds: normalized,
                })
                regularData[fieldId] = normalized
              } else {
                regularData[fieldId] = values
              }
            }
          } else {
            regularData[fieldId] = value
          }
        }

        contextManager.log('DEBUG', undefined, 'CRUD update field routing', {
          regularFields: Object.keys(regularData),
          regularFieldTypes: Object.fromEntries(
            Object.entries(regularData).map(([k, v]) => [k, Array.isArray(v) ? 'array' : typeof v])
          ),
          modeAwareRelationCount: modeAwareRelations.length,
          modeAwareOptionCount: modeAwareOptions.length,
        })

        // Execute standard update for regular fields (including replace-mode relations)
        const result = await handler.updateValues(resourceId, regularData)

        // Execute mode-aware relation updates (add/remove)
        if (modeAwareRelations.length > 0 || modeAwareOptions.length > 0) {
          const fieldValueService = new FieldValueService(organizationId, userId, database)
          const recordId = toRecordId(resource.entityDefinitionId, resourceId)

          const relationPromises = modeAwareRelations.map(({ fieldId, values, updateMode }) => {
            if (updateMode === RelationUpdateMode.ADD) {
              return fieldValueService.addRelationValues({
                recordId,
                fieldId,
                relatedRecordIds: values,
              })
            }
            return fieldValueService.removeRelationValues({
              recordId,
              fieldId,
              relatedRecordIds: values,
            })
          })

          const optionPromises = modeAwareOptions.map(({ fieldId, values, updateMode }) => {
            if (updateMode === RelationUpdateMode.ADD) {
              return fieldValueService.addValues({ recordId, fieldId, values })
            }
            return fieldValueService.removeValues({ recordId, fieldId, values })
          })

          await Promise.all([...relationPromises, ...optionPromises])
        }

        return {
          entityInstance: result.entityInstance,
          id: result.id,
          fieldValues: data, // Return updated field values by name for variable resolution
        }
      }

      case 'delete': {
        if (!resourceId) {
          throw new Error('Resource ID required for delete operation')
        }
        // Use archive method for soft delete - need to build RecordId first
        const recordId = toRecordId(resource.entityDefinitionId, resourceId)
        await handler.archive(recordId)
        return { deleted: true, id: resourceId }
      }

      default:
        throw new Error(`Unsupported operation: ${mode}`)
    }
  }

  /**
   * Map field names (keys) to database field IDs for custom entity operations.
   * The CRUD panel stores data with field.key (human-readable name) as keys,
   * but EntityInstanceService expects field.id (database ID) as keys.
   */
  private mapFieldNamesToIds(
    data: Record<string, any>,
    fields: ResourceField[]
  ): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(data)) {
      // Find field definition by output key (stable identifier), with fallback to key (backward compat)
      const field = fields.find(
        (f) => getFieldOutputKey(f) === key || f.key === key || f.name === key || f.id === key
      )

      if (field?.id) {
        // Use database ID as key for entity operations
        result[field.id] = value
      } else {
        // Fallback: keep original key (for unknown fields)
        result[key] = value
      }
    }

    return result
  }

  /**
   * Execute thread action-based operations
   *
   * Thread operations are ACTION-BASED, not field-based:
   * - Standard fields (status, subject, assigneeId, inboxId) use unified update()
   * - Special fields use dedicated methods (tags, readStatus)
   * - Only UPDATE mode is supported (threads are created via email sync)
   *
   * Field Handling:
   * - status, subject, assigneeId, inboxId -> ThreadMutationService.update()
   * - readStatus -> UnreadService.setReadStatus()
   * - tags -> ThreadMutationService.tagThreadsBulk()
   */
  private async executeThreadOperation(
    mode: 'create' | 'update' | 'delete',
    resourceId: string | undefined,
    data: Record<string, any>,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string

    // Threads only support update mode - actions, not CRUD
    if (mode === 'create') {
      throw new Error(
        'Thread creation is not supported in CRUD node. ' +
          'Threads are created automatically when emails are synced from your email provider.'
      )
    }

    if (mode === 'delete') {
      throw new Error(
        'Thread deletion is not supported in CRUD node. ' +
          'Use status "Trash" to move threads to trash, or "Spam" to mark as spam.'
      )
    }

    if (!resourceId) {
      throw new Error('Thread ID is required for update operations')
    }

    // Initialize services. Configured automation acts as AUTOMATION_SYSTEM
    // (§8.2): full on org inboxes, zero on personal — the §7 write gates
    // enforce it per thread.
    //
    // The WORKFLOW is the actor (thread-events §5.5): `sys.userId` is the
    // workflow AUTHOR's user id, and attributing the change to them reads as
    // "Alice archived this" when Alice's automation did. Lifecycle events
    // carry `data.source: { kind: 'workflow', id, runId }` with a null actor.
    const viewer = await getAutomationVisibility(organizationId)
    const workflowId = (await contextManager.getVariable('sys.workflowId')) as string | undefined
    const executionId = (await contextManager.getVariable('sys.executionId')) as string | undefined
    const mutationService = new ThreadMutationService(
      organizationId,
      database,
      undefined,
      {
        kind: 'workflow',
        ...(workflowId ? { id: workflowId } : {}),
        ...(executionId ? { runId: executionId } : {}),
      },
      viewer
    )
    const unreadService = new UnreadService(organizationId, userId, viewer)

    // Track results for each action. Every key the builder advertises is
    // seeded here so the variable always resolves — an action that was skipped
    // reports `false`/`null` rather than disappearing from the picker.
    const results: Record<string, any> = {
      id: resourceId,
      success: true,
      statusUpdated: false,
      subjectUpdated: false,
      assigneeUpdated: false,
      readStatusUpdated: false,
      tagsUpdated: false,
      inboxUpdated: false,
      primaryEntityUpdated: false,
      newStatus: null,
      newSubject: null,
      newAssigneeId: null,
      newReadStatus: null,
      newInboxId: null,
      newPrimaryEntityId: null,
      actionCount: 0,
      actionsPerformed: [] as string[],
      errors: [] as string[],
    }
    const errors: string[] = []

    // Build unified updates object for standard fields
    const unifiedUpdates: ThreadUpdates = {}

    // Collect standard field updates
    if (data.status !== undefined && data.status !== '') {
      unifiedUpdates.status = data.status
    }
    if (data.subject !== undefined && data.subject !== '') {
      unifiedUpdates.subject = data.subject
    }
    if (data.assignee !== undefined) {
      // `assignee` is the registry field key the panel writes (it is an ACTOR
      // field, so `preprocessNode` does NOT rename it to its `assigneeId`
      // dbColumn the way it renames RELATION fields like `inbox`).
      //
      // Empty/null means unassign. The picker hands back a bare user id;
      // ThreadMutationService parses this as an ActorId and THROWS on a bare
      // one, so prefix it here.
      const [rawAssignee] = parseRelationInput(data.assignee)
      unifiedUpdates.assigneeId = rawAssignee
        ? isActorId(rawAssignee)
          ? rawAssignee
          : toActorId('user', rawAssignee)
        : null
    }
    if (data.inboxId !== undefined && data.inboxId !== '') {
      // A cleared relation field arrives as `null` (preprocessNode maps an empty
      // picker to `ids[0] ?? null`), which means unassign — `String(null)` would
      // otherwise write the literal id `'null'` and blow the FK.
      //
      // Same shape mismatch as assignee: ThreadMutationService takes the instance
      // half off a RecordId, so a bare inbox id would be written as an empty string.
      const [rawInbox] = parseRelationInput(data.inboxId)
      unifiedUpdates.inboxId = rawInbox
        ? isRecordId(rawInbox as RecordId)
          ? (rawInbox as RecordId)
          : toRecordId('inbox', rawInbox)
        : null
    }

    // Execute actions in parallel
    const actionPromises: Promise<void>[] = []

    // UNIFIED UPDATE: status, subject, assigneeId, inboxId in one call
    if (Object.keys(unifiedUpdates).length > 0) {
      const recordId = toRecordId('thread', resourceId)
      actionPromises.push(
        mutationService
          .update(recordId, unifiedUpdates)
          .then((result) => {
            // Track individual field updates for results
            if (unifiedUpdates.status) {
              results.statusUpdated = true
              results.newStatus = unifiedUpdates.status
              results.actionsPerformed.push(`Status changed to ${unifiedUpdates.status}`)
            }
            if (unifiedUpdates.subject) {
              results.subjectUpdated = true
              results.newSubject = unifiedUpdates.subject
              results.actionsPerformed.push(`Subject renamed to "${unifiedUpdates.subject}"`)
            }
            if (unifiedUpdates.assigneeId !== undefined) {
              results.assigneeUpdated = true
              results.newAssigneeId = unifiedUpdates.assigneeId
              results.actionsPerformed.push(
                unifiedUpdates.assigneeId
                  ? `Assigned to user ${unifiedUpdates.assigneeId}`
                  : 'Unassigned'
              )
            }
            if (unifiedUpdates.inboxId) {
              results.inboxUpdated = true
              results.newInboxId = unifiedUpdates.inboxId
              results.actionsPerformed.push(`Moved to inbox ${unifiedUpdates.inboxId}`)
            }
          })
          .catch((err) => {
            errors.push(`Thread update failed: ${err.message}`)
          })
      )
    }

    // SPECIAL: Mark Read/Unread (uses UnreadService)
    if (data.readStatus !== undefined && data.readStatus !== '') {
      actionPromises.push(
        unreadService
          .setReadStatus(resourceId, data.readStatus === 'READ')
          .then(() => {
            results.readStatusUpdated = true
            results.newReadStatus = data.readStatus
            results.actionsPerformed.push(`Marked as ${data.readStatus.toLowerCase()}`)
          })
          .catch((err) => {
            errors.push(`Read status update failed: ${err.message}`)
          })
      )
    }

    // SPECIAL: Link/unlink the primary record (uses the thread links service).
    //
    // The registry's `thread.ticket` field is `dbColumn`-backed by
    // `Thread.primaryEntityInstanceId`, so `preprocessNode` renames it to that
    // column. The pointer is NOT ticket-only (schema `thread.ts`: deal, lead or
    // ticket), and its definition half must be written alongside it or the row
    // is inconsistent — which is exactly what `linkEntityToThread` guarantees:
    // it reads `entityDefinitionId` off the EntityInstance rather than trusting
    // input, and demotes any existing primary to a secondary `ThreadEntityLink`
    // in the same transaction instead of dropping it.
    if (data.primaryEntityInstanceId !== undefined) {
      const [rawPrimary] = parseRelationInput(data.primaryEntityInstanceId)
      const primaryInstanceId = rawPrimary
        ? isRecordId(rawPrimary as RecordId)
          ? getInstanceId(rawPrimary as RecordId)
          : rawPrimary
        : null

      actionPromises.push(
        (async () => {
          // §7 link gate — the same predicate `thread.linkToTicket` applies. An
          // invisible thread is indistinguishable from a nonexistent one.
          if (!(await canLinkThread(database, organizationId, viewer, resourceId))) {
            throw new Error('thread not found')
          }
          if (primaryInstanceId) {
            await linkEntityToThread({
              threadId: resourceId,
              entityInstanceId: primaryInstanceId,
              role: 'primary',
              organizationId,
              actorId: userId,
            })
            results.actionsPerformed.push(`Linked record ${primaryInstanceId}`)
          } else {
            await clearPrimaryEntity({ threadId: resourceId, organizationId, actorId: userId })
            results.actionsPerformed.push('Unlinked primary record')
          }
          results.primaryEntityUpdated = true
          results.newPrimaryEntityId = primaryInstanceId
        })().catch((err) => {
          errors.push(`Record link failed: ${err.message}`)
        })
      )
    }

    // SPECIAL: Update Tags (uses tagThreadsBulk with operation mode)
    if (data.tags !== undefined && data.tags !== '') {
      const { tagIds, operation } = this.parseTagsInputForThread(data.tags)
      if (tagIds.length > 0) {
        actionPromises.push(
          (async () => {
            const [threadEntityDefId, tagEntityDefId] = await Promise.all([
              requireCachedEntityDefId(organizationId, 'thread'),
              requireCachedEntityDefId(organizationId, 'tag'),
            ])
            const threadRecordIds = [toRecordId(threadEntityDefId, resourceId)]
            // Tag ids arrive either bare or already as RecordIds (the picker and
            // upstream node variables disagree); normalize so neither double-prefixes.
            const tagRecordIds = normalizeToRecordIds(tagIds, tagEntityDefId)
            return mutationService
              .tagThreadsBulk(threadRecordIds, tagRecordIds, operation)
              .then((result) => {
                results.tagsUpdated = true
                results.tagsResult = result
                results.actionsPerformed.push(`Tags ${operation}: ${tagIds.length} tag(s)`)
              })
              .catch((err) => {
                errors.push(`Tags update failed: ${err.message}`)
              })
          })()
        )
      }
    }

    // Execute all actions in parallel
    await Promise.all(actionPromises)

    // Determine overall success
    results.success = errors.length === 0
    results.errors = errors
    results.actionCount = results.actionsPerformed.length

    if (errors.length > 0 && results.actionsPerformed.length === 0) {
      // All actions failed
      throw new Error(`All thread actions failed: ${errors.join('; ')}`)
    }

    return { thread: results, id: resourceId }
  }

  /**
   * Parse tags input for thread operations which can come in various formats:
   * - Update-mode envelope: `{ values: [...], updateMode: 'add' | 'remove' | 'replace' }`
   *   — what `preprocessNode` emits for a multi-relation field in update mode,
   *   which is every thread tag write the panel produces
   * - Array of tag IDs / entity objects: ['tag1', { id: 'tag2' }]
   * - Comma-separated string: 'tag1,tag2'
   */
  private parseTagsInputForThread(value: any): {
    tagIds: string[]
    operation: 'add' | 'remove' | 'set'
  } {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'values' in value) {
      const { values, updateMode } = value as {
        values: unknown
        updateMode?: RelationUpdateModeType
      }
      return {
        tagIds: parseRelationInput(values),
        operation: TAG_OPERATION_BY_UPDATE_MODE[updateMode ?? RelationUpdateMode.REPLACE],
      }
    }

    if (typeof value === 'string') {
      return {
        tagIds: value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        operation: 'add',
      }
    }

    return { tagIds: parseRelationInput(value), operation: 'add' }
  }

  /**
   * Handle CRUD error based on configured strategy
   */
  private async handleCrudError(
    error: any,
    config: CrudNodeData,
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    mode: string,
    resourceType: string,
    resourceId?: string
  ): Promise<Partial<NodeExecutionResult>> {
    const errorDetails = this.extractErrorDetails(error)

    // Create user-friendly error message
    let message = 'Error occured while performing CRUD operation'
    if (errorDetails.dbError?.message) {
      // Use the real database error if available
      message = errorDetails.dbError.message
      // Add constraint info if available
      if (errorDetails.dbError.constraint) {
        message += ` (constraint: ${errorDetails.dbError.constraint})`
      }
    } else {
      // Fallback to the wrapper error message
      message = errorDetails.message || message
    }

    // Set common error variables
    contextManager.setNodeVariable(node.nodeId, 'success', false)
    contextManager.setNodeVariable(node.nodeId, 'error', message)
    contextManager.setNodeVariable(node.nodeId, 'errorDetails', errorDetails)
    contextManager.setNodeVariable(node.nodeId, 'operation', mode)
    contextManager.setNodeVariable(node.nodeId, 'resourceType', resourceType)
    switch (`${config.error_strategy}`) {
      case 'continue':
        // Continue workflow with error information
        contextManager.log('WARN', node.name, `${mode} operation failed but continuing`, {
          error: message,
          strategy: 'continue',
        })
        return {
          status: NodeRunningStatus.Succeeded,
          output: {
            success: false,
            error: message,
            errorDetails,
            operation: mode,
            resourceType,
            resourceId,
          },
          outputHandle: 'source', // Continue on success path
          metadata: {
            operation: mode,
            resourceType,
            success: false,
            continuedOnError: true,
          },
        }
      case 'default':
        // Use default values if configured
        if (config.default_values && config.default_values.length > 0) {
          const defaultResult = await this.processDefaultValues(
            config.default_values,
            contextManager
          )
          // Set default value variables
          Object.entries(defaultResult).forEach(([key, value]) => {
            contextManager.setNodeVariable(node.nodeId, key, value)
          })
          // Both of these are advertised by the builder whenever the strategy is
          // `default`, for every resource type — write them, not just `output`.
          contextManager.setNodeVariable(node.nodeId, 'usedDefaults', true)
          contextManager.setNodeVariable(node.nodeId, 'defaultValues', defaultResult)
          contextManager.log('INFO', node.name, `${mode} operation failed, using default values`, {
            defaultValueCount: config.default_values.length,
          })
          return {
            status: NodeRunningStatus.Succeeded,
            output: {
              success: false,
              usedDefaults: true,
              defaultValues: defaultResult,
              error: message,
              operation: mode,
              resourceType,
            },
            outputHandle: 'source', // Success path with defaults
            metadata: {
              operation: mode,
              resourceType,
              success: false,
              usedDefaults: true,
            },
          }
        }
        // No default values configured — `usedDefaults`/`defaultValues` are
        // declared by the builder whenever the strategy is `default`, for
        // every resource type, same as the branch above. Write them here too
        // before falling through to `fail`, so they still resolve on this run
        // instead of being left permanently unresolvable.
        contextManager.setNodeVariable(node.nodeId, 'usedDefaults', false)
        contextManager.setNodeVariable(node.nodeId, 'defaultValues', null)
      // Fall through to fail if no defaults configured
      case 'fail':
      default:
        // Fail the workflow and route to fail branch
        return {
          status: NodeRunningStatus.Failed,
          error: message,
          output: {
            error: message,
            errorDetails,
            operation: mode,
            resourceType,
            resourceId,
          },
          outputHandle: 'fail', // Fail handle
          metadata: {
            operation: mode,
            resourceType,
            success: false,
            failed: true,
          },
        }
    }
  }

  /**
   * Extract structured error details for debugging
   * Handles Drizzle ORM errors specially to expose underlying database errors
   */
  private extractErrorDetails(error: any): any {
    const baseDetails = {
      name: error.name || 'Error',
      message: error.message,
      timestamp: new Date().toISOString(),
    }

    // Handle Drizzle ORM query errors - extract the real database error from cause
    if (error.cause) {
      return {
        ...baseDetails,
        // Extract real database error details
        dbError: {
          code: error.cause.code, // PostgreSQL error code (23502, 23505, etc.)
          message: error.cause.message, // Real error message
          detail: error.cause.detail, // Additional error details
          constraint: error.cause.constraint, // Constraint name if applicable
          table: error.cause.table, // Table name
          column: error.cause.column, // Column name
        },
        // Include query context for debugging
        query: error.query,
        params: error.params,
        // Standard properties
        code: error.code,
        meta: error.meta,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }
    }

    // Handle standard errors (non-Drizzle)
    return {
      ...baseDetails,
      code: error.code,
      meta: error.meta,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }
  }
  /**
   * Process default values similar to HTTP node
   */
  private async processDefaultValues(
    defaultValues: CrudDefaultValue[],
    contextManager: ExecutionContextManager
  ): Promise<any> {
    const result: any = {}

    // Interpolate all values in parallel
    const interpolatedValues = await Promise.all(
      defaultValues.map((dv) => this.interpolateVariables(dv.value, contextManager))
    )

    // Process each default value with its interpolated result
    defaultValues.forEach((defaultValue, index) => {
      const value = interpolatedValues[index]!
      switch (defaultValue.type) {
        case 'string':
          result[defaultValue.key] = value
          break
        case 'number':
          result[defaultValue.key] = parseFloat(value) || 0
          break
        case 'boolean':
          result[defaultValue.key] = value.toLowerCase() === 'true'
          break
        case 'object':
        case 'array':
          try {
            result[defaultValue.key] = JSON.parse(value)
          } catch {
            result[defaultValue.key] = value
          }
          break
        default:
          result[defaultValue.key] = value
      }
    })

    return result
  }
}
