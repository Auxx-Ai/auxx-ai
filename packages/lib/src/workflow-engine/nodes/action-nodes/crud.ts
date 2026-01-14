// packages/lib/src/workflow-engine/nodes/action-nodes/crud.ts
import { BaseNodeProcessor } from '../base-node'
import type {
  WorkflowNode,
  NodeExecutionResult,
  ValidationResult,
  PreprocessedNodeData,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import {
  ContactService,
  type CreateContactInput,
  type UpdateContactInput,
} from '../../../contacts/contact-service'
import {
  TicketService,
  type CreateTicketInput,
  type UpdateTicketInput,
} from '../../../tickets/ticket-service'
import { ThreadMutationService } from '../../../threads/thread-mutation.service'
import { UnreadService } from '../../../threads/unread-service'
import { FieldValueService, type ModelType as FieldModelType } from '@auxx/lib/field-values'
import { ModelTypes, type ModelType } from '@auxx/database'
import { database, type Database } from '@auxx/database'
import { getCrudField, CRUD_RESOURCE_CONFIGS } from '../../../resources/crud-definitions'
import {
  isValidEnumValue,
  getEnumValues,
  type EnumValue,
  getField,
  getAllFields,
  setEntityVariables,
  isSystemResourceId,
  isCustomResourceId,
} from '../../../resources/registry'
import { BaseType } from '../../core/types'
import type { TableId } from '../../../resources/registry/field-registry'
import { createResourceReference } from '../../types/resource-reference'
import { ResourceRegistryService } from '../../../resources/registry/resource-registry-service'
import { EntityInstanceService } from '../../../entity-instances/entity-instance-service'
import type { CustomResource } from '../../../resources/registry/types'
import type { ResourceField } from '../../../resources/registry/field-types'
/**
 * CRUD node data interface
 * Supports both system resources (contact, ticket) and custom entities (UUID/CUID format)
 */
interface CrudNodeData {
  resourceType: string // System: 'contact', 'ticket' | Custom: UUID/CUID like 'f08vj083a926klhzkr2tbfvy'
  mode: 'create' | 'update' | 'delete'
  resourceId?: string // For update/delete operations
  data: Record<string, any> // Field values
  error_strategy: 'fail' | 'continue' | 'default'
  default_values: CrudDefaultValue[]
}
/**
 * CRUD default value configuration
 */
interface CrudDefaultValue {
  key: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value: string
}
/**
 * CRUD node processor for handling create, read, update, delete operations
 * Supports both system resources (contact, ticket) and custom entities
 */
export class CrudNodeProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.CRUD
  private resourceServiceCache: ResourceRegistryService | null = null

  constructor() {
    super()
  }

  /**
   * Get or create a ResourceRegistryService instance for the given organization
   */
  private getResourceService(organizationId: string, db: Database): ResourceRegistryService {
    if (!this.resourceServiceCache) {
      this.resourceServiceCache = new ResourceRegistryService(organizationId, db)
    }
    return this.resourceServiceCache
  }
  /**
   * Preprocess CRUD node - resolve variables and validate configuration
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as CrudNodeData

    // Resolve and extract resource ID for update/delete operations
    let resolvedResourceId: string | undefined = undefined
    if (config.resourceId) {
      resolvedResourceId = await this.extractIdFromValue(config.resourceId, contextManager)

      // Log for debugging if extraction failed
      if (config.resourceId && !resolvedResourceId) {
        contextManager.log('WARN', node.name, 'Failed to extract ID from resourceId value', {
          configResourceId: config.resourceId,
        })
      }

      // Validate that ID was extracted for update/delete operations
      if ((config.mode === 'update' || config.mode === 'delete') && !resolvedResourceId) {
        throw new Error(
          'Resource ID is required for update and delete operations. ' +
            'Please select a valid resource or ID from a previous node.'
        )
      }
    }

    // Resolve variables in field data
    const resolvedData: Record<string, any> = {}
    if (config.data) {
      // Resolve all field values in parallel
      const fieldEntries = Object.entries(config.data)
      const resolvedValues = await Promise.all(
        fieldEntries.map(([_, value]) => this.resolveFieldValue(value, contextManager))
      )

      // Process resolved values
      fieldEntries.forEach(([key, _], index) => {
        const resolvedValue = resolvedValues[index]
        const field = getField(config.resourceType, key)

        // Transform RELATION fields: extract ID and map to dbColumn
        if (field?.type === BaseType.RELATION && field.dbColumn) {
          // Primary format: plain ID string
          // Legacy support: {referenceId: "xxx"} or {id: "xxx"} objects
          if (typeof resolvedValue === 'object' && resolvedValue !== null) {
            // Handle legacy object formats from JSON parsing
            const extractedId = resolvedValue.referenceId || resolvedValue.id || null
            resolvedData[field.dbColumn] = extractedId
          } else {
            // Plain string ID (preferred format)
            resolvedData[field.dbColumn] = resolvedValue || null
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

    // Check for {{variable}} pattern anywhere in string
    // This handles exact wrapping, partial patterns, and concatenation
    // Examples: "{{var}}", "{{var}}suffix", "prefix{{var}}", "{{var1}} and {{var2}}"
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
        const expectedTargetTable = field.relationship.relatedEntityDefinitionId

        // If value is a variable reference (e.g., "{{node-123.contact}}")
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          const variablePath = value.slice(2, -2).trim()
          const variable = await contextManager.getVariable(variablePath)

          // Check if variable is an object with metadata
          if (variable && typeof variable === 'object' && 'reference' in variable) {
            const reference = (variable as any).reference

            // Parse reference to get target table
            if (reference && typeof reference === 'string') {
              const parts = reference.split(':')
              if (parts.length === 2) {
                const [sourceResourceType, sourceFieldKey] = parts
                const sourceField = getField(sourceResourceType as TableId, sourceFieldKey!)

                if (sourceField?.type === BaseType.RELATION && sourceField.relationship) {
                  const actualTargetTable = sourceField.relationship.relatedEntityDefinitionId

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

    // Validate that resourceType is either a system resource or custom entity
    const isSystemResource = isSystemResourceId(config.resourceType)
    const isCustomEntity = isCustomResourceId(config.resourceType)

    if (config.resourceType && !isSystemResource && !isCustomEntity) {
      errors.push(
        `Unknown resource type: ${config.resourceType}. Must be a system resource (contact, ticket, etc.) or custom entity UUID.`
      )
      return { valid: false, errors, warnings }
    }

    // Only do static validation for system resources
    // Custom entities will be validated at runtime with actual entity definition
    if (isSystemResource) {
      const crudConfig = CRUD_RESOURCE_CONFIGS[config.resourceType as TableId]

      if (!crudConfig) {
        // This shouldn't happen if isSystemResourceId() works correctly
        errors.push(`Unknown system resource type: ${config.resourceType}`)
        return { valid: false, errors, warnings }
      }

      // Validate required fields for create using registry (system resources only)
      if (config.mode === 'create') {
        for (const field of crudConfig.requiredFields) {
          const value = config.data?.[field.key]
          if (!value || (typeof value === 'string' && value.trim() === '')) {
            errors.push(`${field.label} is required for creating ${config.resourceType}`)
          }
        }
      }

      // Validate enum values using registry (system resources only)
      if (config.data) {
        for (const [fieldKey, value] of Object.entries(config.data)) {
          if (!value) continue

          const field = getCrudField(config.resourceType, fieldKey)
          if (!field) continue

          if (field.type === BaseType.ENUM) {
            const isVariable = typeof value === 'string' && value.trim().startsWith('{{')
            if (!isVariable && !isValidEnumValue(config.resourceType, fieldKey, value as string)) {
              const validValues = getEnumValues(config.resourceType, fieldKey)
                .map((ev: EnumValue) => ev.label)
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
    if (config.error_strategy && !['fail', 'continue', 'default'].includes(config.error_strategy)) {
      errors.push('Error strategy must be fail, continue, or default')
    }

    // Validate default values if using default strategy
    if (config.error_strategy === 'default') {
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
      const result = await this.executeCrudOperation(
        resourceType,
        mode,
        resourceId,
        data,
        contextManager
      )

      // Get organization ID for resource reference
      const organizationId = (await contextManager.getVariable('sys.organizationId')) as string

      // Set success variables
      contextManager.setNodeVariable(node.nodeId, 'operation', mode)
      contextManager.setNodeVariable(node.nodeId, 'resourceType', resourceType)
      contextManager.setNodeVariable(node.nodeId, 'success', true)
      contextManager.setNodeVariable(node.nodeId, 'error', null)

      // Store resource reference for create/update operations
      if (result.id && mode !== 'delete') {
        // Store commonly accessed fields directly for performance
        contextManager.setNodeVariable(node.nodeId, 'id', result.id)

        const ref = createResourceReference(resourceType, result.id, organizationId)

        // For custom entities, use setEntityVariables (same as triggers)
        if (isCustomResourceId(resourceType)) {
          // Build resourceData in the format setEntityVariables expects
          const entityData = {
            id: result.id,
            entityDefinitionId: result.entityInstance?.entityDefinitionId,
            createdAt: result.entityInstance?.createdAt,
            updatedAt: result.entityInstance?.updatedAt,
            fieldValues: result.fieldValues || {},
          }

          // This sets variables exactly like triggers do:
          // - nodeId.{entityDefId} (ResourceReference) - e.g., nodeId.f08vj083a926klhzkr2tbfvy
          // - nodeId.{entityDefId}.id
          // - nodeId.{entityDefId}.fieldName (for each field)
          setEntityVariables(resourceType, entityData, contextManager, node.nodeId)

          // Also store under 'record' key for convenience
          contextManager.setNodeVariable(node.nodeId, 'record', ref)
        } else {
          // System resources - existing behavior
          contextManager.setNodeVariable(node.nodeId, resourceType, ref)

          // Store commonly accessed scalar fields directly to avoid lazy loading overhead
          const resourceData = result[resourceType] || result.entityInstance
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
          resourceType,
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

    // Check if this is a custom entity (UUID/CUID format)
    if (isCustomResourceId(resourceType)) {
      const resourceService = this.getResourceService(organizationId, database)
      const resource = await resourceService.getById(resourceType)

      if (!resource) {
        throw new Error(`Unknown custom resource type: ${resourceType}`)
      }

      return await this.executeEntityOperation(
        resource as CustomResource,
        mode,
        resourceId,
        data,
        contextManager
      )
    }

    // System resource operations
    switch (resourceType) {
      case 'contact':
        return await this.executeContactOperation(mode, resourceId, data, contextManager)
      case 'ticket':
        return await this.executeTicketOperation(mode, resourceId, data, contextManager)
      case 'thread':
        return await this.executeThreadOperation(mode, resourceId, data, contextManager)
      default:
        throw new Error(`Unsupported system resource type: ${resourceType}`)
    }
  }

  /**
   * Execute CRUD operations for custom entities using EntityInstanceService
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

    const entityInstanceService = new EntityInstanceService(organizationId, userId)

    switch (mode) {
      case 'create': {
        // Use the createWithValues method - handles both instance creation and field values
        const result = await entityInstanceService.createWithValues(
          resource.entityDefinitionId,
          dataWithFieldIds
        )
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
        // Use the updateValues method - handles field value updates
        const result = await entityInstanceService.updateValues(resourceId, dataWithFieldIds)
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
        // Use archive method for soft delete
        await entityInstanceService.archive(resourceId)
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
      // Find field definition by key (human-readable name)
      const field = fields.find((f) => f.key === key)

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
   * - Each field maps to a specific service method
   * - Multiple actions can be performed in a single update
   * - Only UPDATE mode is supported (threads are created via email sync)
   *
   * Action Field Mapping:
   * - status    -> ThreadMutationService.updateThreadStatus()
   * - subject   -> ThreadMutationService.updateThreadSubject()
   * - assignee  -> ThreadMutationService.assignThread()
   * - readStatus -> UnreadService.markThreadAsRead/Unread()
   * - tags      -> ThreadMutationService.tagThreadsBulk()
   * - inbox     -> ThreadMutationService.moveThreadsToInbox()
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

    // Initialize services
    const mutationService = new ThreadMutationService(organizationId, database)
    const unreadService = new UnreadService(organizationId, userId)

    // Track results for each action
    const results: Record<string, any> = {
      id: resourceId,
      actionsPerformed: [] as string[],
    }
    const errors: string[] = []

    // Execute actions in parallel (they're independent)
    const actionPromises: Promise<void>[] = []

    // ACTION: Update Status
    if (data.status !== undefined && data.status !== '') {
      actionPromises.push(
        mutationService
          .updateThreadStatus(resourceId, data.status)
          .then(() => {
            results.statusUpdated = true
            results.newStatus = data.status
            results.actionsPerformed.push(`Status changed to ${data.status}`)
          })
          .catch((err) => {
            errors.push(`Status update failed: ${err.message}`)
          })
      )
    }

    // ACTION: Update Subject (Rename)
    if (data.subject !== undefined && data.subject !== '') {
      actionPromises.push(
        mutationService
          .updateThreadSubject(resourceId, data.subject)
          .then(() => {
            results.subjectUpdated = true
            results.newSubject = data.subject
            results.actionsPerformed.push(`Subject renamed to "${data.subject}"`)
          })
          .catch((err) => {
            errors.push(`Subject update failed: ${err.message}`)
          })
      )
    }

    // ACTION: Assign/Unassign
    if (data.assigneeId !== undefined) {
      // Note: Empty string or null means unassign
      const assigneeId = data.assigneeId === '' ? null : data.assigneeId
      actionPromises.push(
        mutationService
          .assignThread(resourceId, assigneeId)
          .then(() => {
            results.assigneeUpdated = true
            results.newAssigneeId = assigneeId
            results.actionsPerformed.push(
              assigneeId ? `Assigned to user ${assigneeId}` : 'Unassigned'
            )
          })
          .catch((err) => {
            errors.push(`Assignee update failed: ${err.message}`)
          })
      )
    }

    // ACTION: Mark Read/Unread (Virtual Field)
    if (data.readStatus !== undefined && data.readStatus !== '') {
      const markPromise =
        data.readStatus === 'READ'
          ? unreadService.markThreadAsRead(resourceId)
          : unreadService.markThreadAsUnread(resourceId)

      actionPromises.push(
        markPromise
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

    // ACTION: Update Tags (Virtual Field with Operation Mode)
    if (data.tags !== undefined && data.tags !== '') {
      const tagOperation = data.tagOperation || 'add'
      const { tagIds } = this.parseTagsInputForThread(data.tags)
      if (tagIds.length > 0) {
        actionPromises.push(
          mutationService
            .tagThreadsBulk([resourceId], tagIds, tagOperation)
            .then((result) => {
              results.tagsUpdated = true
              results.tagsResult = result
              results.actionsPerformed.push(`Tags ${tagOperation}: ${tagIds.length} tag(s)`)
            })
            .catch((err) => {
              errors.push(`Tags update failed: ${err.message}`)
            })
        )
      }
    }

    // ACTION: Move to Inbox
    if (data.inboxId !== undefined && data.inboxId !== '') {
      actionPromises.push(
        mutationService
          .moveThreadsToInbox([resourceId], data.inboxId, userId)
          .then(() => {
            results.inboxUpdated = true
            results.newInboxId = data.inboxId
            results.actionsPerformed.push(`Moved to inbox ${data.inboxId}`)
          })
          .catch((err) => {
            errors.push(`Inbox move failed: ${err.message}`)
          })
      )
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
   * - Array of tag IDs: ['tag1', 'tag2']
   * - Comma-separated string: 'tag1,tag2'
   */
  private parseTagsInputForThread(value: any): { tagIds: string[] } {
    let tagIds: string[] = []

    if (typeof value === 'string') {
      tagIds = value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    } else if (Array.isArray(value)) {
      tagIds = value
    }

    return { tagIds }
  }

  /**
   * Execute contact-specific CRUD operations
   */
  private async executeContactOperation(
    mode: 'create' | 'update' | 'delete',
    resourceId: string | undefined,
    data: Record<string, any>,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string

    const contactService = new ContactService(organizationId, userId, database)
    // Separate standard fields from custom fields
    const { standardData, customFieldData } = this.separateFieldData(data, 'contact')
    switch (mode) {
      case 'create': {
        const createInput: CreateContactInput = {
          email: standardData.email,
          firstName: standardData.firstName,
          lastName: standardData.lastName,
          phone: standardData.phone,
          notes: standardData.notes,
          tags: standardData.tags ? this.parseTagsValue(standardData.tags) : [],
          sourceType: standardData.sourceType || 'MANUAL',
        }
        const contact = await contactService.createContact(createInput)
        // Handle custom fields
        await this.setCustomFieldValues(
          organizationId,
          userId,
          contact.id,
          customFieldData,
          ModelTypes.CONTACT
        )
        return { contact, id: contact.id }
      }
      case 'update': {
        if (!resourceId) throw new Error('Resource ID required for update operation')
        const updateInput: UpdateContactInput = {
          id: resourceId,
          firstName: standardData.firstName,
          lastName: standardData.lastName,
          email: standardData.email,
          phone: standardData.phone,
          notes: standardData.notes,
          tags: standardData.tags ? this.parseTagsValue(standardData.tags) : undefined,
          status: standardData.status,
        }
        const updatedContact = await contactService.updateContact(updateInput)
        // Update custom fields
        await this.setCustomFieldValues(
          organizationId,
          userId,
          resourceId,
          customFieldData,
          ModelTypes.CONTACT
        )
        return { contact: updatedContact, id: resourceId }
      }
      case 'delete': {
        if (!resourceId) throw new Error('Resource ID required for delete operation')
        await contactService.deleteContact(resourceId)
        return { deleted: true, id: resourceId }
      }
      default:
        throw new Error(`Unsupported operation: ${mode}`)
    }
  }
  /**
   * Execute ticket-specific CRUD operations
   */
  private async executeTicketOperation(
    mode: 'create' | 'update' | 'delete',
    resourceId: string | undefined,
    data: Record<string, any>,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string

    const ticketService = new TicketService(database)

    // Separate standard fields from custom fields
    const { standardData, customFieldData } = this.separateFieldData(data, 'ticket')

    switch (mode) {
      case 'create':
        return await this.createTicket(
          ticketService,
          standardData,
          customFieldData,
          organizationId,
          userId
        )

      case 'update':
        if (!resourceId) throw new Error('Resource ID required for update operation')
        return await this.updateTicket(
          ticketService,
          resourceId,
          standardData,
          customFieldData,
          organizationId,
          userId
        )

      case 'delete':
        if (!resourceId) throw new Error('Resource ID required for delete operation')
        return await this.deleteTicket(ticketService, resourceId, organizationId, userId)

      default:
        throw new Error(`Unsupported operation: ${mode}`)
    }
  }

  /**
   * Create a new ticket with custom fields
   */
  private async createTicket(
    ticketService: TicketService,
    standardData: Record<string, any>,
    customFieldData: Record<string, any>,
    organizationId: string,
    userId: string
  ): Promise<any> {
    // Validate that relation fields use database column names
    this.validateRelationFields(standardData, 'ticket', 'create')

    // Build CreateTicketInput from standardData
    const createInput: CreateTicketInput = {
      title: standardData.title,
      description: standardData.description,
      type: standardData.type,
      priority: standardData.priority,
      status: standardData.status,
      contactId: standardData.contactId,
      assignedToId: standardData.assignedToId,
      dueDate: standardData.dueDate ? new Date(standardData.dueDate) : undefined,
      typeData: standardData.typeData || {},
      typeStatus: standardData.typeStatus,
      organizationId,
      userId,
    }

    // Create the ticket
    const ticket = await ticketService.createTicket(createInput)

    // Handle custom fields
    await this.setCustomFieldValues(
      organizationId,
      userId,
      ticket.id,
      customFieldData,
      ModelTypes.TICKET
    )

    return { ticket, id: ticket.id }
  }

  /**
   * Update an existing ticket with custom fields
   */
  private async updateTicket(
    ticketService: TicketService,
    resourceId: string,
    standardData: Record<string, any>,
    customFieldData: Record<string, any>,
    organizationId: string,
    userId: string
  ): Promise<any> {
    // Validate that relation fields use database column names
    this.validateRelationFields(standardData, 'ticket', 'update')

    // Build UpdateTicketInput
    const updateInput: UpdateTicketInput = {
      id: resourceId,
      title: standardData.title,
      description: standardData.description,
      priority: standardData.priority,
      status: standardData.status,
      dueDate: standardData.dueDate ? new Date(standardData.dueDate) : undefined,
      typeData: standardData.typeData,
      typeStatus: standardData.typeStatus,
      organizationId,
      userId,
    }

    // Update ticket
    const updatedTicket = await ticketService.updateTicket(updateInput)

    // Update custom fields
    await this.setCustomFieldValues(
      organizationId,
      userId,
      resourceId,
      customFieldData,
      ModelTypes.TICKET
    )

    return { ticket: updatedTicket, id: resourceId }
  }

  /**
   * Delete a ticket and all its related data
   */
  private async deleteTicket(
    ticketService: TicketService,
    resourceId: string,
    organizationId: string,
    userId: string
  ): Promise<any> {
    await ticketService.deleteTicket(resourceId, organizationId, userId)

    return { deleted: true, id: resourceId }
  }
  /**
   * Validate that relation fields use database column names, not logical names
   *
   * This validation ensures that preprocessing happened correctly and relation fields
   * are using the physical database column names (e.g., "contactId") instead of
   * logical field names (e.g., "contact").
   *
   * @param data - Field data to validate
   * @param resourceType - Resource type (e.g., 'ticket', 'contact')
   * @param operation - Operation type ('create' or 'update')
   * @throws Error if logical field names are detected instead of database column names
   */
  private validateRelationFields(
    data: Record<string, any>,
    resourceType: TableId,
    operation: 'create' | 'update'
  ): void {
    // Get all fields for this resource type
    const allFields = getAllFields(resourceType)

    // Filter to only relation fields with dbColumn defined
    const relationFields = allFields.filter(
      (field) => field.type === BaseType.RELATION && field.dbColumn
    )

    // Check if any logical names are being used instead of dbColumn names
    const invalidFields = relationFields.filter((field) => {
      // If data has the logical name but NOT the database column name, that's invalid
      return data[field.key] !== undefined && data[field.dbColumn!] === undefined
    })

    if (invalidFields.length > 0) {
      const fieldNames = invalidFields.map((f) => `"${f.key}" should be "${f.dbColumn}"`).join(', ')

      throw new Error(
        `Invalid relation field names in ${operation} operation for ${resourceType}. ` +
          `Found logical names instead of database columns: ${fieldNames}. ` +
          `This indicates a preprocessing failure. Please ensure preprocessNode() was called.`
      )
    }
  }

  /**
   * Separate standard fields from custom fields
   *
   * This method provides a defensive layer to ensure relation fields use database
   * column names even if preprocessing somehow failed. This should rarely be needed
   * since preprocessing is now enforced, but provides an extra safety check.
   *
   * @param data - Field data (should already have relation fields transformed)
   * @param resourceType - Resource type (e.g., 'ticket', 'contact')
   */
  private separateFieldData(data: Record<string, any>, resourceType: TableId) {
    const standardData: Record<string, any> = {}
    const customFieldData: Record<string, any> = {}

    Object.entries(data).forEach(([key, value]) => {
      if (key.startsWith('custom_')) {
        // Custom field: extract field ID and parse value
        const fieldId = key.replace('custom_', '')
        customFieldData[fieldId] = this.parseCustomFieldValue(value)
      } else {
        // Standard field: check if it's a relation field that needs transformation
        const field = getField(resourceType, key)

        if (field?.type === BaseType.RELATION && field.dbColumn) {
          // This is a relation field with logical name - transform to database column
          // NOTE: This should rarely happen since preprocessing handles this,
          // but provides a safety net for edge cases
          standardData[field.dbColumn] = value
        } else {
          // Non-relation field: pass through as-is
          standardData[key] = value
        }
      }
    })

    return { standardData, customFieldData }
  }
  /**
   * Set custom field values for an entity
   */
  private async setCustomFieldValues(
    organizationId: string,
    userId: string,
    entityId: string,
    customFieldData: Record<string, any>,
    modelType: ModelType
  ): Promise<void> {
    const fieldValueService = new FieldValueService(organizationId, userId, database)

    // Map ModelType to FieldModelType
    const fieldModelType: FieldModelType =
      modelType === ModelTypes.CONTACT
        ? 'contact'
        : modelType === ModelTypes.TICKET
          ? 'ticket'
          : modelType === ModelTypes.THREAD
            ? 'thread'
            : 'entity'

    const promises = Object.entries(customFieldData)
      .map(([fieldId, value]) => {
        if (value === null || value === undefined || value === '') return null
        return fieldValueService.setValueWithBuiltIn({
          entityId,
          fieldId,
          value,
          modelType: fieldModelType,
        })
      })
      .filter(Boolean)
    await Promise.all(promises)
  }
  /**
   * Parse tags value from string or array
   */
  private parseTagsValue(value: string | string[]): string[] {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    }
    return Array.isArray(value) ? value : []
  }
  /**
   * Parse custom field value from various formats
   */
  private parseCustomFieldValue(value: any): any {
    // Handle different custom field value formats
    if (typeof value === 'string') {
      // Try to parse JSON for complex types
      if (value.startsWith('{') || value.startsWith('[')) {
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }
      // Handle comma-separated values (tags, multi-select)
      if (value.includes(',')) {
        return value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      }
    }
    return value
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
    switch (config.error_strategy) {
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
