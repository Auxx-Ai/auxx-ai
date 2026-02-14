// packages/lib/src/workflow-engine/nodes/action-nodes/find.ts

import { type Database, database, schema } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { FIND_RESOURCE_CONFIGS } from '../../../resources/find-definitions'
import {
  getFieldOperators,
  getFieldOptions,
  isCustomResourceId,
  isValidFieldOptionValue,
  isValidOperatorForField,
  RESOURCE_FIELD_REGISTRY,
} from '../../../resources/registry'
import type { TableId } from '../../../resources/registry/field-registry'
import { ResourceRegistryService } from '../../../resources/registry/resource-registry-service'
import { executeResourceQuery } from '../../../resources/resource-fetcher'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { BaseType, NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ConditionGroup, GenericCondition } from '../../query-builder/base-condition-builder'
import { ConditionQueryBuilder } from '../../query-builder/condition-query-builder'
import { BaseNodeProcessor } from '../base-node'

interface FindNodeData {
  resourceType: string // Supports both system resources and custom entities (UUID/CUID format)
  findMode: 'findOne' | 'findMany'
  conditions: GenericCondition[] // For backward compatibility
  conditionGroups: ConditionGroup[] // Primary grouping system
  orderBy?: {
    field: string
    direction: 'asc' | 'desc'
  }
  limit?: number | string // Can be number (constant) or string (variable reference)
  fieldModes?: Record<string, boolean> // Field modes for VarEditor (true = constant mode)
}

/**
 * Drizzle query shape produced by the builder
 */
type BuiltQuery = {
  where?: SQL<unknown>
  orderBy?: SQL<unknown>[]
  limit?: number
}

/**
 * Processor for find nodes that search for resources with dynamic filters and sorting
 */
export class FindProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.FIND
  private resourceService: ResourceRegistryService | null = null

  /**
   * Get or create ResourceRegistryService instance
   */
  private getResourceService(organizationId: string, db: Database): ResourceRegistryService {
    if (!this.resourceService) {
      this.resourceService = new ResourceRegistryService(organizationId, db)
    }
    return this.resourceService
  }

  /**
   * Validate condition values against registry (especially enums and operators)
   * For custom entities, validation is skipped - EntityConditionBuilder handles it at execution time
   */
  private validateConditionValues(resourceType: string, conditions: GenericCondition[]): string[] {
    const errors: string[] = []

    // Skip validation for custom entities - field IDs are UUIDs, not static registry keys
    // EntityConditionBuilder will validate fields during query building
    if (isCustomResourceId(resourceType)) {
      return errors
    }

    for (const condition of conditions) {
      // Handle custom fields separately (for system resources with custom_ prefixed fields)
      if (condition.fieldId.startsWith('custom_')) {
        // Custom fields are loaded dynamically, so we can't validate against registry
        // Just validate that value is provided when needed
        if (this.isValueRequiredOperator(condition.operator)) {
          if (condition.value === '' || condition.value == null) {
            errors.push(
              `Custom field condition requires a value for operator "${condition.operator}"`
            )
          }
        }
        continue
      }

      const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[condition.fieldId]

      if (!field) {
        errors.push(`Unknown field: ${condition.fieldId}`)
        continue
      }

      // ✅ Validate operator is valid for field
      if (!isValidOperatorForField(field, condition.operator)) {
        const validOperators = getFieldOperators(field)
        errors.push(
          `Invalid operator "${condition.operator}" for field "${field.label}". ` +
            `Valid operators: ${validOperators.join(', ')}`
        )
        continue
      }

      // ✅ Validate option values (updated to use 'is' operator)
      if (field.type === BaseType.ENUM && condition.operator === 'is') {
        if (
          !isValidFieldOptionValue(
            resourceType as TableId,
            condition.fieldId,
            String(condition.value)
          )
        ) {
          const validValues = getFieldOptions(field)
            .map((opt) => opt.value)
            .join(', ')
          errors.push(
            `Invalid value for ${field.label}: "${condition.value}". Valid values: ${validValues}`
          )
        }
      }

      // Validate 'in' operator option values
      if (
        field.type === BaseType.ENUM &&
        (condition.operator === 'in' || condition.operator === 'not in')
      ) {
        const values = Array.isArray(condition.value) ? condition.value : [condition.value]
        for (const val of values) {
          if (!isValidFieldOptionValue(resourceType as TableId, condition.fieldId, String(val))) {
            const validValues = getFieldOptions(field)
              .map((opt) => opt.value)
              .join(', ')
            errors.push(`Invalid value for ${field.label}: "${val}". Valid values: ${validValues}`)
          }
        }
      }

      // NEW: Validate RELATION field values
      if (field.type === BaseType.RELATION && field.relationship) {
        // For 'is' and 'is not' operators on relation fields
        if (['is', 'is not', '=', '!='].includes(condition.operator)) {
          if (!condition.value) {
            errors.push(`${field.label} requires a value for operator "${condition.operator}"`)
            continue
          }

          // Value can be:
          // 1. String (ID or variable reference)
          // 2. Object with referenceId property
          const value = condition.value

          if (typeof value === 'string') {
            // Variable references are OK (validated at runtime)
            if (value.startsWith('{{') && value.endsWith('}}')) {
              continue
            }

            // Empty string is not allowed
            if (value.length === 0) {
              errors.push(`${field.label} cannot be empty`)
            }
          } else if (typeof value === 'object' && value.referenceId) {
            // Object with referenceId
            if (!value.referenceId || value.referenceId.length === 0) {
              errors.push(`${field.label} referenceId cannot be empty`)
            }
          }
        }

        // For 'in' and 'not in' operators
        if (['in', 'not in'].includes(condition.operator)) {
          if (!Array.isArray(condition.value) || condition.value.length === 0) {
            errors.push(
              `${field.label} requires an array of values for operator "${condition.operator}"`
            )
          }
        }
      }
    }

    return errors
  }

  /**
   * Check if an operator requires a value
   */
  private isValueRequiredOperator(operator: string): boolean {
    const valueRequiredOperators = [
      'is',
      'is not',
      '=',
      '!=',
      'contains',
      'not contains',
      'starts with',
      'ends with',
      '>',
      '<',
      '>=',
      '<=',
      'in',
      'not in',
    ]
    return valueRequiredOperators.includes(operator)
  }

  /**
   * Preprocess find node - resolve conditions and variables early
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as FindNodeData

    // Resolve flat conditions (for backward compatibility) - in parallel
    let resolvedConditions: GenericCondition[] = []
    if (config.conditions) {
      const conditionValues = await Promise.all(
        config.conditions.map((c) => this.resolveConditionValue(c.value, contextManager))
      )
      resolvedConditions = config.conditions
        .map((condition, index) => ({
          ...condition,
          value: conditionValues[index],
        }))
        .filter((condition) => {
          // Filter out incomplete conditions (empty values for operators that need them)
          if (
            ['isEmpty', 'isNotEmpty', 'empty', 'not empty', 'exists', 'not exists'].includes(
              condition.operator
            )
          ) {
            return true // These operators don't need values
          }
          return condition.value !== '' && condition.value != null
        })
    }

    // Resolve grouped conditions - in parallel
    let resolvedGroups: ConditionGroup[] = []
    if (config.conditionGroups) {
      const groupPromises = config.conditionGroups.map(async (group) => {
        const conditionValues = await Promise.all(
          group.conditions.map((c) => this.resolveConditionValue(c.value, contextManager))
        )
        return {
          ...group,
          conditions: group.conditions
            .map((condition, index) => ({
              ...condition,
              value: conditionValues[index],
            }))
            .filter((condition) => {
              // Filter out incomplete conditions
              if (
                ['isEmpty', 'isNotEmpty', 'empty', 'not empty', 'exists', 'not exists'].includes(
                  condition.operator
                )
              ) {
                return true
              }
              return condition.value !== '' && condition.value != null
            }),
        }
      })
      resolvedGroups = await Promise.all(groupPromises)
    }

    // Resolve limit if it's a variable (string) or object (legacy)
    let resolvedLimit: number | undefined
    if (config.limit !== undefined) {
      if (typeof config.limit === 'string') {
        // Variable mode: resolve the variable reference
        const interpolated = await this.interpolateVariables(config.limit, contextManager)
        resolvedLimit = parseInt(interpolated, 10)
        if (Number.isNaN(resolvedLimit) || resolvedLimit <= 0) {
          resolvedLimit = 10 // Default to 10 if invalid
        }
      } else if (typeof config.limit === 'object') {
        // Legacy object-based variable reference
        resolvedLimit = Number(await this.resolveVariableValue(config.limit, contextManager))
      } else {
        // Constant mode: use the number directly
        resolvedLimit = config.limit
      }
    }

    const totalConditions =
      resolvedConditions.length +
      resolvedGroups.reduce((total, group) => total + group.conditions.length, 0)

    return {
      inputs: {
        resourceType: config.resourceType,
        findMode: config.findMode,
        conditions: resolvedConditions,
        conditionGroups: resolvedGroups,
        orderBy: config.orderBy,
        limit: resolvedLimit,
      },
      metadata: {
        nodeType: 'find',
        resourceType: config.resourceType,
        conditionCount: totalConditions,
        groupCount: resolvedGroups.length,
        preprocessedAt: new Date().toISOString(),
      },
    }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const config = node.data as unknown as FindNodeData

    try {
      // Use preprocessed data if available, otherwise compute on the fly
      let resourceType: string
      let findMode: 'findOne' | 'findMany'
      let conditions: GenericCondition[]
      let conditionGroups: ConditionGroup[]
      let orderBy: FindNodeData['orderBy']
      let limit: number | undefined

      if (preprocessedData?.inputs) {
        resourceType = preprocessedData.inputs.resourceType
        findMode = preprocessedData.inputs.findMode
        conditions = preprocessedData.inputs.conditions
        conditionGroups = preprocessedData.inputs.conditionGroups
        orderBy = preprocessedData.inputs.orderBy
        limit = preprocessedData.inputs.limit
      } else {
        // WARNING: This is a fallback path. Preprocessing (preprocessNode) is preferred for performance.
        // This path is slower as it resolves conditions sequentially.
        resourceType = config.resourceType
        findMode = config.findMode

        // Process flat conditions (backward compatibility) - parallel
        if (config.conditions) {
          const conditionValues = await Promise.all(
            config.conditions.map((c) => this.resolveConditionValue(c.value, contextManager))
          )
          conditions = config.conditions
            .map((condition, index) => ({
              ...condition,
              value: conditionValues[index],
            }))
            .filter((condition) => {
              // Filter out incomplete conditions (empty values for operators that need them)
              if (
                ['isEmpty', 'isNotEmpty', 'empty', 'not empty', 'exists', 'not exists'].includes(
                  condition.operator
                )
              ) {
                return true // These operators don't need values
              }
              return condition.value !== '' && condition.value != null
            })
        } else {
          conditions = []
        }

        // Process grouped conditions - parallel
        if (config.conditionGroups) {
          const groupPromises = config.conditionGroups.map(async (group) => {
            const conditionValues = await Promise.all(
              group.conditions.map((c) => this.resolveConditionValue(c.value, contextManager))
            )
            return {
              ...group,
              conditions: group.conditions
                .map((condition, index) => ({
                  ...condition,
                  value: conditionValues[index],
                }))
                .filter((condition) => {
                  // Filter out incomplete conditions
                  if (
                    [
                      'isEmpty',
                      'isNotEmpty',
                      'empty',
                      'not empty',
                      'exists',
                      'not exists',
                    ].includes(condition.operator)
                  ) {
                    return true
                  }
                  return condition.value !== '' && condition.value != null
                }),
            }
          })
          conditionGroups = await Promise.all(groupPromises)
        } else {
          conditionGroups = []
        }

        orderBy = config.orderBy

        // Resolve limit if it's a variable (string) or object (legacy)
        if (config.limit !== undefined) {
          if (typeof config.limit === 'string') {
            // Variable mode: resolve the variable reference
            const interpolated = await this.interpolateVariables(config.limit, contextManager)
            limit = parseInt(interpolated, 10)
            if (Number.isNaN(limit) || limit <= 0) {
              limit = 10 // Default to 10 if invalid
            }
          } else if (typeof config.limit === 'object') {
            // Legacy object-based variable reference
            limit = Number(await this.resolveVariableValue(config.limit, contextManager))
          } else {
            // Constant mode: use the number directly
            limit = config.limit
          }
        }
      }

      // Get execution context
      const context = contextManager.getContext()
      const organizationId = context.organizationId
      const db = database

      // Resolve resource from registry (system or custom)
      const resourceService = this.getResourceService(organizationId, db)
      const resource = await resourceService.getById(resourceType)
      if (!resource) {
        throw new Error(`Unknown resource type: ${resourceType}`)
      }

      // Get fields for validation (used by entity condition builder)
      await resourceService.getFieldsForResource(resourceType)

      // Validate conditions using dynamic fields
      const flatConditionErrors = this.validateConditionValues(resourceType, conditions)
      const groupConditionErrors: string[] = []
      for (const group of conditionGroups) {
        const groupErrors = this.validateConditionValues(resourceType, group.conditions)
        groupConditionErrors.push(...groupErrors)
      }

      const allValidationErrors = [...flatConditionErrors, ...groupConditionErrors]
      if (allValidationErrors.length > 0) {
        throw new Error(`Invalid conditions: ${allValidationErrors.join(', ')}`)
      }

      const totalConditions =
        conditions.length +
        conditionGroups.reduce((total, group) => total + group.conditions.length, 0)

      contextManager.log('DEBUG', node.nodeId, `Executing ${findMode} query for ${resourceType}`, {
        flatConditions: conditions.length,
        groups: conditionGroups.length,
        totalConditions,
        orderBy,
        limit,
      })

      // Execute query based on resource type and find mode
      let result
      let resultCount: number

      console.log('🔍 [FindProcessor] Executing query', {
        findMode,
        resourceType,
        organizationId,
        isCustomResource: resourceService.isCustomResource(resourceType),
      })

      if (resourceService.isCustomResource(resourceType)) {
        // Handle custom entity query
        const queryResult = await this.executeCustomEntityQuery(
          resourceType,
          organizationId,
          db,
          conditions,
          conditionGroups,
          orderBy,
          limit,
          findMode
        )
        result = queryResult.results
        resultCount = queryResult.count
      } else {
        // Handle system resource query (existing logic)
        const query = this.buildQuery(
          resourceType as TableId,
          conditions,
          conditionGroups,
          orderBy,
          limit
        )
        const queryResult = {
          results: await this.executeQueryOne(query, resourceType as TableId, organizationId),
          count: 1,
        }

        if (findMode === 'findMany') {
          const manyResult = await this.executeQueryMany(
            query,
            resourceType as TableId,
            organizationId
          )
          result = manyResult
          resultCount = Array.isArray(manyResult) ? manyResult.length : 0
        } else {
          result = queryResult.results
          resultCount = queryResult.results ? 1 : 0
        }
      }

      console.log('🔍 [FindProcessor] Query executed', {
        findMode,
        resourceType,
        resultCount,
        resultType: Array.isArray(result) ? 'array' : typeof result,
      })

      contextManager.log(
        'INFO',
        node.nodeId,
        `Found ${resultCount} ${resource.plural.toLowerCase()}`
      )

      // Prepare output object using resource's plural name
      const pluralName = resource.plural.toLowerCase()
      const outputData = {
        [pluralName]: result,
        count: resultCount,
        query_info: {
          resource_type: resourceType,
          find_mode: findMode,
          flat_conditions_applied: conditions.length,
          groups_applied: conditionGroups.length,
          total_conditions: totalConditions,
          order_by: orderBy?.field,
          limit_applied: limit,
        },
      }

      // Store outputs as variables based on findMode and resource plural name
      if (findMode === 'findOne') {
        // Singular: ticket, contact, vendor, etc. (use resource singular label)
        contextManager.setNodeVariable(node.nodeId, resource.label.toLowerCase(), result)
      } else {
        // Plural: tickets, contacts, vendors, etc. (use resource plural name)
        contextManager.setNodeVariable(node.nodeId, pluralName, result)
      }

      // Always store count and query_info
      contextManager.setNodeVariable(node.nodeId, 'count', resultCount)
      contextManager.setNodeVariable(node.nodeId, 'query_info', outputData.query_info)

      return {
        status: NodeRunningStatus.Succeeded,
        output: outputData,
      }
    } catch (error) {
      contextManager.log(
        'ERROR',
        node.nodeId,
        `Find node execution failed: ${error instanceof Error ? error.message : String(error)}`
      )

      return {
        status: NodeRunningStatus.Failed,
        error: `Failed to find ${config.resourceType}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Build database query from conditions and groups using ConditionQueryBuilder
   * Note: This is only for system resources - custom entities use executeCustomEntityQuery
   */
  private buildQuery(
    resourceType: TableId,
    conditions: GenericCondition[],
    conditionGroups: ConditionGroup[],
    orderBy?: FindNodeData['orderBy'],
    limit?: number
  ): BuiltQuery {
    let whereClause: SQL<unknown> | undefined

    console.log('🔍 [FindProcessor] Building query', {
      resourceType,
      hasGroups: conditionGroups.length > 0,
      groupCount: conditionGroups.length,
      flatConditionCount: conditions.length,
      orderBy,
      limit,
    })

    if (conditionGroups.length > 0) {
      console.log('🔍 [FindProcessor] Building grouped query with groups:', {
        groups: conditionGroups.map((g, i) => ({
          index: i,
          logicalOp: g.logicalOperator,
          conditionCount: g.conditions.length,
          conditions: g.conditions.map((c) => ({
            fieldId: c.fieldId,
            operator: c.operator,
            value: c.value,
            isCustomField: c.fieldId.startsWith('custom_'),
          })),
        })),
      })
      whereClause = this.buildGroupedQuery(conditionGroups, resourceType)
    } else if (conditions.length > 0) {
      console.log('🔍 [FindProcessor] Building flat query with conditions:', {
        conditions: conditions.map((c) => ({
          fieldId: c.fieldId,
          operator: c.operator,
          value: c.value,
          isCustomField: c.fieldId.startsWith('custom_'),
        })),
      })
      whereClause = ConditionQueryBuilder.buildWhereSql(conditions, resourceType)
    }

    const orderByClause = orderBy
      ? ConditionQueryBuilder.buildOrderBySql(
          orderBy.field,
          orderBy.direction || 'asc',
          resourceType
        )
      : undefined

    const builtQuery = {
      where: whereClause,
      orderBy: orderByClause,
      limit,
    }

    console.log('🔍 [FindProcessor] Query built', {
      hasWhereClause: !!whereClause,
      hasOrderBy: !!orderByClause,
      limit,
    })

    return builtQuery
  }

  /**
   * Build query from condition groups
   */
  private buildGroupedQuery(
    groups: ConditionGroup[],
    resourceType: TableId
  ): SQL<unknown> | undefined {
    return ConditionQueryBuilder.buildGroupedQuery(groups, resourceType)
  }

  /**
   * Execute findOne query using shared resource fetcher
   */
  private async executeQueryOne(
    query: BuiltQuery,
    resourceType: TableId,
    organizationId: string | undefined
  ) {
    return executeResourceQuery(resourceType, organizationId, query, 'findOne')
  }

  /**
   * Execute findMany query using shared resource fetcher
   */
  private async executeQueryMany(
    query: BuiltQuery,
    resourceType: TableId,
    organizationId: string | undefined
  ) {
    return executeResourceQuery(resourceType, organizationId, query, 'findMany')
  }

  /**
   * Execute custom entity query against EntityInstance table
   * Field values are stored in CustomFieldValue table (not on EntityInstance)
   */
  private async executeCustomEntityQuery(
    resourceType: string,
    organizationId: string,
    db: Database,
    conditions: GenericCondition[],
    conditionGroups: ConditionGroup[],
    orderBy: FindNodeData['orderBy'] | undefined,
    limit: number | undefined,
    findMode: 'findOne' | 'findMany'
  ): Promise<{ results: any[] | any; count: number }> {
    // resourceType is now EntityDefinitionId (UUID) directly
    const entityDefinitionId = resourceType

    // Get entity definition
    const entityDef = await db.query.EntityDefinition.findFirst({
      where: (defs, { eq, and, isNull }) =>
        and(
          eq(defs.id, entityDefinitionId),
          eq(defs.organizationId, organizationId),
          isNull(defs.archivedAt)
        ),
    })

    if (!entityDef) {
      throw new Error(`Entity definition not found: ${entityDefinitionId}`)
    }

    // Get fields for this entity to build proper query context
    const resourceService = this.getResourceService(organizationId, db)
    const fields = await resourceService.getFieldsForResource(resourceType)

    // Import EntityConditionBuilder
    const { entityConditionBuilder } = await import('../../query-builder/entity-condition-builder')

    // Build query context for entity
    // outerTable provides direct column reference for proper Drizzle table context in subqueries
    const entityContext = {
      fields,
      outerTable: schema.EntityInstance,
    }

    // Build WHERE clause using EntityConditionBuilder
    let whereClause: SQL<unknown> | undefined

    if (conditionGroups.length > 0) {
      whereClause = entityConditionBuilder.buildGroupedQuery(conditionGroups, entityContext)
    } else if (conditions.length > 0) {
      whereClause = entityConditionBuilder.buildWhereSql(conditions, entityContext)
    }

    // Build ORDER BY clause
    let orderByClause: SQL<unknown>[] | undefined
    if (orderBy) {
      orderByClause = entityConditionBuilder.buildOrderBySql(
        orderBy.field,
        orderBy.direction || 'asc',
        entityContext
      )
    }

    // Build base query with organization and entity filters
    const baseWhere = (instances: any, { eq, and, isNull }: any) => {
      const baseConditions = [
        eq(instances.entityDefinitionId, entityDef.id),
        eq(instances.organizationId, organizationId),
        isNull(instances.archivedAt),
      ]

      // Add field conditions if any
      if (whereClause) {
        return and(...baseConditions, whereClause)
      }

      return and(...baseConditions)
    }

    // Execute query
    const results = await db.query.EntityInstance.findMany({
      where: baseWhere,
      orderBy: orderByClause,
      limit: findMode === 'findOne' ? 1 : limit,
    })

    return {
      results: findMode === 'findOne' ? (results[0] ?? null) : results,
      count: results.length,
    }
  }

  /**
   * Resolve condition values that might be variables
   */
  private async resolveConditionValue(
    value: any,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      // Extract variable name from {{varName}} format
      const varName = value.slice(2, -2).trim()
      const resolvedValue = await contextManager.getVariable(varName)
      return resolvedValue !== undefined ? resolvedValue : value
    }
    return value
  }

  /**
   * Resolve variable values
   */
  protected async resolveVariableValue(
    variable: any,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    if (typeof variable === 'object' && 'varName' in variable) {
      return await contextManager.getVariable(variable.varName)
    }
    return variable
  }

  /**
   * Extract variables from filter conditions
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as FindNodeData
    const variables = new Set<string>()

    // Extract from flat conditions (backward compatibility)
    if (config.conditions && Array.isArray(config.conditions)) {
      config.conditions.forEach((condition: GenericCondition) => {
        // Add variableId if present
        if (condition.variableId) {
          variables.add(condition.variableId)
        }

        // Extract from value if it's a string with variables
        if (condition.value && typeof condition.value === 'string') {
          this.extractVariableIds(condition.value).forEach((v) => variables.add(v))
        }
      })
    }

    // Extract from condition groups
    if (config.conditionGroups && Array.isArray(config.conditionGroups)) {
      config.conditionGroups.forEach((group: ConditionGroup) => {
        group.conditions?.forEach((condition: GenericCondition) => {
          // Add variableId if present
          if (condition.variableId) {
            variables.add(condition.variableId)
          }

          // Extract from value if it's a string with variables
          if (condition.value && typeof condition.value === 'string') {
            this.extractVariableIds(condition.value).forEach((v) => variables.add(v))
          }
        })
      })
    }

    // Extract from limit if it's a variable reference
    if (config.limit && typeof config.limit === 'string') {
      this.extractVariableIds(config.limit).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as FindNodeData

    // Validate resource type
    if (!config.resourceType) {
      errors.push('Resource type is required')
    }
    // Note: We can't fully validate unknown resource types here at design time
    // Runtime validation using ResourceRegistryService will catch invalid types

    // Validate find mode
    if (!config.findMode || !['findOne', 'findMany'].includes(config.findMode)) {
      errors.push('Find mode must be either "findOne" or "findMany"')
    }

    // Validate flat conditions (backward compatibility)
    // For system resources, we can validate against FIND_RESOURCE_CONFIGS
    // For custom entities, validation happens at runtime
    const isSystemResource =
      config.resourceType && FIND_RESOURCE_CONFIGS[config.resourceType as TableId]

    if (isSystemResource) {
      const resourceConfig = FIND_RESOURCE_CONFIGS[config.resourceType as TableId]!

      config.conditions?.forEach((condition, index) => {
        // Skip validation for custom fields (they're loaded dynamically)
        if (condition.fieldId.startsWith('custom_')) {
          // Just validate value is provided when needed
          if (
            this.isValueRequiredOperator(condition.operator) &&
            (condition.value === '' || condition.value == null)
          ) {
            warnings.push(
              `Flat Condition ${index + 1}: Please provide a value for custom field (will be ignored during execution)`
            )
          }
          return
        }

        const field = resourceConfig.filterableFields.find((f: any) => f.key === condition.fieldId)
        if (!field) {
          errors.push(
            `Flat Condition ${index + 1}: Invalid field "${condition.fieldId}" for ${config.resourceType}`
          )
        } else {
          if (!isValidOperatorForField(field, condition.operator)) {
            const validOperators = getFieldOperators(field)
            errors.push(
              `Flat Condition ${index + 1}: Operator "${condition.operator}" not supported for field "${condition.fieldId}". Valid operators: ${validOperators.join(', ')}`
            )
          }
        }

        // Validate value is provided for operators that need it
        const valueRequiredOperators = [
          '=',
          '!=',
          'equals',
          'not equals',
          'contains',
          'not contains',
          'starts with',
          'ends with',
          '>',
          '<',
          '>=',
          '<=',
          'greaterThan',
          'lessThan',
          'greaterThanOrEqual',
          'lessThanOrEqual',
          'in',
          'not in',
        ]
        if (
          valueRequiredOperators.includes(condition.operator) &&
          (condition.value === '' || condition.value == null)
        ) {
          // Treat empty values as warnings rather than errors to allow UI editing
          warnings.push(
            `Flat Condition ${index + 1}: Please provide a value for operator "${condition.operator}" (will be ignored during execution)`
          )
        }
      })
    } else if (config.resourceType && isCustomResourceId(config.resourceType)) {
      // For custom entities, we can't validate at design time, so just warn
      if ((config.conditions?.length || 0) > 0) {
        warnings.push('Flat conditions on custom entities will be validated at runtime')
      }
    }

    // Validate condition groups
    if (isSystemResource) {
      const resourceConfig = FIND_RESOURCE_CONFIGS[config.resourceType as TableId]!
      config.conditionGroups?.forEach((group, groupIndex) => {
        if (group.conditions.length === 0) {
          warnings.push(`Group ${groupIndex + 1}: Empty group will be ignored during execution`)
        }

        group.conditions.forEach((condition, condIndex) => {
          // Skip validation for custom fields (they're loaded dynamically)
          if (condition.fieldId.startsWith('custom_')) {
            // Just validate value is provided when needed
            if (
              this.isValueRequiredOperator(condition.operator) &&
              (condition.value === '' || condition.value == null)
            ) {
              warnings.push(
                `Group ${groupIndex + 1}, Condition ${condIndex + 1}: Please provide a value for custom field (will be ignored during execution)`
              )
            }
            return
          }

          const field = resourceConfig.filterableFields.find(
            (f: any) => f.key === condition.fieldId
          )
          if (!field) {
            errors.push(
              `Group ${groupIndex + 1}, Condition ${condIndex + 1}: Invalid field "${condition.fieldId}" for ${config.resourceType}`
            )
          } else {
            if (!isValidOperatorForField(field, condition.operator)) {
              const validOperators = getFieldOperators(field)
              errors.push(
                `Group ${groupIndex + 1}, Condition ${condIndex + 1}: Operator "${condition.operator}" not supported for field "${condition.fieldId}". Valid operators: ${validOperators.join(', ')}`
              )
            }
          }

          // Validate value is provided for operators that need it
          const valueRequiredOperators = [
            '=',
            '!=',
            'equals',
            'not equals',
            'contains',
            'not contains',
            'starts with',
            'ends with',
            '>',
            '<',
            '>=',
            '<=',
            'greaterThan',
            'lessThan',
            'greaterThanOrEqual',
            'lessThanOrEqual',
            'in',
            'not in',
          ]
          if (
            valueRequiredOperators.includes(condition.operator) &&
            (condition.value === '' || condition.value == null)
          ) {
            warnings.push(
              `Group ${groupIndex + 1}, Condition ${condIndex + 1}: Please provide a value for operator "${condition.operator}" (will be ignored during execution)`
            )
          }
        })
      })
    } else if (config.resourceType && isCustomResourceId(config.resourceType)) {
      // For custom entities, we can't validate at design time, so just warn
      if ((config.conditionGroups?.length || 0) > 0) {
        warnings.push('Condition groups on custom entities will be validated at runtime')
      }
    }

    // Validate orderBy field
    if (config.orderBy && config.resourceType && isSystemResource) {
      const resourceConfig = FIND_RESOURCE_CONFIGS[config.resourceType as TableId]!
      const sortableField = resourceConfig.sortableFields.find(
        (f: any) => f.key === config.orderBy!.field
      )
      if (!sortableField) {
        errors.push(
          `Order by field "${config.orderBy.field}" is not sortable for ${config.resourceType}`
        )
      }
    }

    // Validate limit
    if (config.limit !== undefined) {
      if (typeof config.limit === 'number') {
        if (config.limit < 1) {
          errors.push('Limit must be at least 1')
        } else if (config.limit > 1000) {
          errors.push('Limit cannot exceed 1000')
        }
      }
    }

    // Warnings
    const totalConditions =
      (config.conditions?.length || 0) +
      (config.conditionGroups?.reduce((total, group) => total + group.conditions.length, 0) || 0)

    if (totalConditions === 0) {
      warnings.push(
        'No conditions or groups applied - will return all records (limited by default/specified limit)'
      )
    }

    if (config.findMode === 'findOne' && totalConditions > 5) {
      warnings.push(
        'Consider using fewer total conditions for findOne mode to ensure predictable results'
      )
    }

    // Warn about mixed usage
    if ((config.conditions?.length || 0) > 0 && (config.conditionGroups?.length || 0) > 0) {
      warnings.push(
        'Both flat conditions and groups are present. Groups will take precedence and flat conditions will be ignored.'
      )
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
