// packages/lib/src/workflow-engine/nodes/transform-nodes/list-processor.ts

import {
  type FieldPath,
  type FieldReference,
  parseResourceFieldId,
  type ResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { getCachedResourceFields } from '../../../cache'
import { evaluateOperator, isKnownOperator } from '../../../conditions/evaluate-operator'
import type { ResourceField } from '../../../resources/registry/field-types'
import { ErrorStrategy, normalizeErrorStrategy } from '../../catalog/error-handling'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { isResourceReference, type ResourceReference } from '../../types/resource-reference'
import { BaseNodeProcessor } from '../base-node'
import type { SortConfig } from '../types/list-types'

/** How multiple filter conditions combine. */
type FilterLogic = 'AND' | 'OR'

export class ListProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.LIST

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    try {
      contextManager.log('INFO', node.name, `Executing list operation: ${node.data.operation}`)

      // Get the input list - strip braces from variable reference (e.g., "{{find1.items}}" -> "find1.items")
      const inputListKey = node.data.inputList?.replace(/[{}]/g, '') || ''
      const inputList = await contextManager.getVariable(inputListKey)

      // Validate input is an array
      if (!Array.isArray(inputList)) {
        throw new Error(`Input is not an array: ${typeof inputList}`)
      }

      // If the array contains ResourceReferences, prefetch needed fields and resolve to plain objects
      let resolvedList = inputList
      if (inputList.length > 0 && isResourceReference(inputList[0])) {
        const firstRef = inputList[0] as ResourceReference
        const entityDefId = firstRef.resourceType
        const orgId = firstRef.organizationId

        contextManager.log('DEBUG', node.name, 'Detected ResourceReference array', {
          count: inputList.length,
          entityDefId,
          operation: node.data.operation,
        })

        // Look up entity fields to resolve plain field keys to ResourceFieldIds
        const entityFields = await getCachedResourceFields(orgId, entityDefId)
        const neededFieldRefs = this.getRequiredFieldRefs(node.data, entityDefId, entityFields)

        contextManager.log('DEBUG', node.name, 'Resolved field refs for prefetch', {
          neededFieldRefs: neededFieldRefs.map((r) => (Array.isArray(r) ? r.join('::') : r)),
          entityFieldCount: entityFields.length,
        })

        if (neededFieldRefs.length > 0) {
          await contextManager.prefetchFields(inputList, neededFieldRefs)
          resolvedList = await contextManager.resolveRecordArray(
            inputList,
            neededFieldRefs,
            entityFields
          )

          contextManager.log('DEBUG', node.name, 'Resolved ResourceReference array', {
            resolvedCount: resolvedList.length,
            sampleItem: resolvedList[0]
              ? {
                  hasFieldValues: !!resolvedList[0].fieldValues,
                  fieldValueKeys: resolvedList[0].fieldValues
                    ? Object.keys(resolvedList[0].fieldValues)
                    : [],
                  sampleValues: resolvedList[0].fieldValues
                    ? Object.fromEntries(
                        Object.entries(resolvedList[0].fieldValues).map(([k, v]) => [
                          k,
                          typeof v === 'object' ? `[object ${typeof v}]` : v,
                        ])
                      )
                    : {},
                }
              : null,
          })
        } else {
          contextManager.log(
            'WARN',
            node.name,
            'No field refs resolved — ResourceRefs not resolved',
            {
              operation: node.data.operation,
              configField:
                node.data.joinConfig?.field ??
                node.data.filterConfig?.conditions?.[0]?.fieldId ??
                'unknown',
            }
          )
        }
      }

      // Execute the appropriate operation.
      //
      // `count` is advertised by the builder's picker for exactly the three
      // operations that change how many items come out (`output-variables.ts`),
      // so it is set here for those three and left undefined for the rest — an
      // operation that never drops an item has nothing to report that
      // `result.length` does not already say.
      let result: any
      let count: number | undefined

      switch (node.data.operation) {
        case 'filter':
          result = await this.executeFilter(resolvedList, node.data.filterConfig, contextManager)
          count = result.length
          break

        case 'sort':
          result = await this.executeSort(resolvedList, node.data.sortConfig)
          break

        case 'slice':
          result = await this.executeSlice(resolvedList, node.data.sliceConfig, contextManager)
          count = Array.isArray(result) ? result.length : 1
          break

        case 'unique':
          result = await this.executeUnique(resolvedList, node.data.uniqueConfig)
          count = result.length
          break

        case 'join':
          result = await this.executeJoin(resolvedList, node.data.joinConfig)
          break

        case 'pluck':
          result = await this.executePluck(resolvedList, node.data.pluckConfig)
          break

        case 'reverse':
          result = [...resolvedList].reverse()
          break

        default:
          throw new Error(`Unknown operation: ${node.data.operation}`)
      }

      // Publish the outputs with node scoping so downstream nodes can address
      // them as `<nodeId>.result` / `<nodeId>.count`. Both paths are written
      // with a literal name on purpose: a computed key here is invisible to the
      // builder↔engine parity reader, which is how `count` came to be filed as
      // drift while it was in fact being published.
      contextManager.setNodeVariable(node.nodeId, 'result', result)
      if (count !== undefined) {
        contextManager.setNodeVariable(node.nodeId, 'count', count)
      }

      contextManager.log(
        'INFO',
        node.name,
        `List operation completed. Result type: ${Array.isArray(result) ? 'array' : typeof result}`
      )

      return {
        status: NodeRunningStatus.Succeeded,
        output: { result, ...(count !== undefined && { count }) },
        outputHandle: 'source', // Standard output for transform nodes
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      contextManager.log('ERROR', node.name, `List operation failed: ${errorMessage}`)

      // Apply the node's failure policy (`catalog/error-handling.ts`). This
      // replaces the `outputHandle: 'error'` it used to emit — a handle no
      // manifest declared, no `node.tsx` rendered and no edge could address, so
      // the run died anyway (plan 21 §14.2). Behaviour is preserved exactly for
      // a node with no stored `error_strategy`: it resolves to `fail`, and
      // `findFailureEdge` still finds nothing to route to.
      //
      // The `'fail'` literal stays inline here rather than in a shared helper:
      // the builder↔engine parity reader extracts emitted handles per processor
      // FILE, so a handle emitted from a util would drop out of the contract.
      const strategy = normalizeErrorStrategy(
        (node.data as { error_strategy?: unknown }).error_strategy
      )
      if (strategy === ErrorStrategy.continue) {
        // `result` is the only variable this node advertises, so it is the only
        // one the continue arm may write — publishing an `error` variable here
        // would advertise an address the builder's picker never offers.
        contextManager.setNodeVariable(node.nodeId, 'result', null)
        return {
          status: NodeRunningStatus.Succeeded,
          output: { result: null, error: errorMessage },
          outputHandle: 'source',
        }
      }
      return {
        status: NodeRunningStatus.Failed,
        error: errorMessage,
        outputHandle: 'fail',
      }
    }
  }

  /**
   * Convert ResourceFieldId/FieldPath to a dot-path for in-memory filtering.
   * - FieldPath: ["contact:contact_tickets", "ticket:subject"] → "contact_tickets.subject"
   * - ResourceFieldId: "contact:email" → "email"
   * - Plain string fallback: "email" → "email"
   */
  private resolveFilterField(fieldId: string | string[]): string {
    if (Array.isArray(fieldId)) {
      return fieldId.map((rfId) => parseResourceFieldId(rfId as ResourceFieldId).fieldId).join('.')
    }

    if (typeof fieldId === 'string' && fieldId.includes(':')) {
      return parseResourceFieldId(fieldId as ResourceFieldId).fieldId
    }

    return fieldId
  }

  /**
   * Filter operation implementation
   */
  private async executeFilter(
    list: any[],
    config: any,
    contextManager: ExecutionContextManager
  ): Promise<any[]> {
    if (!config || !config.conditions || config.conditions.length === 0) {
      return list
    }

    const logic = this.resolveFilterLogic(config)

    contextManager.log('DEBUG', undefined, 'Applying list filter', {
      logic,
      conditions: config.conditions.map((c: any) => ({
        fieldId: Array.isArray(c?.fieldId) ? c.fieldId.join('::') : c?.fieldId,
        operator: c?.operator,
      })),
    })

    // Operator semantics come from `conditions/evaluate-operator.ts` — the same
    // implementation the if-else node and mail/record-rule filters use, so `is` cannot
    // mean one thing here and another there.
    const matches = (item: any, condition: any): boolean => {
      const fieldKey = this.resolveFilterField(condition.fieldId ?? condition.field)
      const fieldValue = this.getNestedValue(item, fieldKey)
      return evaluateOperator(fieldValue, condition.operator, condition.value)
    }

    return list.filter((item) =>
      logic === 'OR'
        ? config.conditions.some((condition: any) => matches(item, condition))
        : config.conditions.every((condition: any) => matches(item, condition))
    )
  }

  /**
   * Resolve how the filter's conditions combine.
   *
   * The builder's condition list writes the AND/OR choice onto every condition after
   * the first (`logicalOperator`) and the list panel mirrors that onto
   * `filterConfig.logic`. Read the node-level key first, fall back to the per-condition
   * marker, and default to AND — which is what the panel writes (and displays) the
   * moment a second condition is added.
   */
  private resolveFilterLogic(config: any): FilterLogic {
    const explicit = typeof config.logic === 'string' ? config.logic.toUpperCase() : undefined
    if (explicit === 'AND' || explicit === 'OR') return explicit

    for (const condition of config.conditions ?? []) {
      const perCondition =
        typeof condition?.logicalOperator === 'string'
          ? condition.logicalOperator.toUpperCase()
          : undefined
      if (perCondition === 'AND' || perCondition === 'OR') return perCondition
    }

    return 'AND'
  }

  /**
   * Sort operation implementation (simplified single field sort)
   */
  private async executeSort(list: any[], config: SortConfig): Promise<any[]> {
    if (!config || !config.field) {
      return list
    }

    const sorted = [...list].sort((a, b) => {
      const aValue = this.getNestedValue(a, config.field)
      const bValue = this.getNestedValue(b, config.field)

      // Handle null/undefined values
      if (aValue == null && bValue == null) return 0
      if (aValue == null) return config.nullHandling === 'first' ? -1 : 1
      if (bValue == null) return config.nullHandling === 'first' ? 1 : -1

      // Compare values
      let comparison = 0
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue
      } else {
        comparison = String(aValue).localeCompare(String(bValue))
      }

      return config.direction === 'desc' ? -comparison : comparison
    })

    return sorted
  }

  /**
   * Slice operation implementation
   */
  private async executeSlice(
    list: any[],
    config: any,
    contextManager: ExecutionContextManager
  ): Promise<any[] | any> {
    if (!config || !config.mode) return list

    switch (config.mode) {
      case 'first': {
        // Resolve count (could be variable or constant)
        let count = 1
        if (config.count !== undefined) {
          if (config.isCountConstant ?? true) {
            count = typeof config.count === 'number' ? config.count : parseInt(config.count, 10)
          } else {
            // Resolve variable
            const resolvedValue = await contextManager.getVariable(config.count)
            count = typeof resolvedValue === 'number' ? resolvedValue : parseInt(resolvedValue, 10)
            if (Number.isNaN(count) || count < 1) {
              throw new Error(`Invalid count value: ${resolvedValue}. Must be a positive number.`)
            }
          }
        }

        const sliced = list.slice(0, count)
        // Return single item if count=1, otherwise return array
        return count === 1 ? sliced[0] : sliced
      }

      case 'last': {
        // Resolve count (could be variable or constant)
        let count = 1
        if (config.count !== undefined) {
          if (config.isCountConstant ?? true) {
            count = typeof config.count === 'number' ? config.count : parseInt(config.count, 10)
          } else {
            // Resolve variable
            const resolvedValue = await contextManager.getVariable(config.count)
            count = typeof resolvedValue === 'number' ? resolvedValue : parseInt(resolvedValue, 10)
            if (Number.isNaN(count) || count < 1) {
              throw new Error(`Invalid count value: ${resolvedValue}. Must be a positive number.`)
            }
          }
        }

        const sliced = list.slice(-count)
        // Return single item if count=1, otherwise return array
        return count === 1 ? sliced[0] : sliced
      }

      case 'range': {
        // Resolve start
        let start = 0
        if (config.start !== undefined) {
          if (config.isStartConstant ?? true) {
            start = typeof config.start === 'number' ? config.start : parseInt(config.start, 10)
          } else {
            const resolvedValue = await contextManager.getVariable(config.start)
            start = typeof resolvedValue === 'number' ? resolvedValue : parseInt(resolvedValue, 10)
            if (Number.isNaN(start) || start < 0) {
              throw new Error(
                `Invalid start value: ${resolvedValue}. Must be a non-negative number.`
              )
            }
          }
        }

        // Resolve end
        let end = list.length
        if (config.end !== undefined) {
          if (config.isEndConstant ?? true) {
            end = typeof config.end === 'number' ? config.end : parseInt(config.end, 10)
          } else {
            const resolvedValue = await contextManager.getVariable(config.end)
            end = typeof resolvedValue === 'number' ? resolvedValue : parseInt(resolvedValue, 10)
            if (Number.isNaN(end)) {
              throw new Error(`Invalid end value: ${resolvedValue}. Must be a number.`)
            }
          }
        }

        return list.slice(start, end)
      }

      default:
        return list
    }
  }

  /**
   * Unique operation implementation
   */
  private async executeUnique(list: any[], config: any): Promise<any[]> {
    if (!config) return list

    if (config.by === 'whole') {
      const seen = new Set()
      const result: any[] = []
      const iterate = config.keepFirst === false ? [...list].reverse() : list
      for (const item of iterate) {
        if (!seen.has(item)) {
          seen.add(item)
          result.push(item)
        }
      }
      return config.keepFirst === false ? result.reverse() : result
    }

    // Field-based dedup — resolve FieldPath/ResourceFieldId to dot-separated keys
    const resolvedField = this.resolveFilterField(config.field)
    const seen = new Set()
    const unique: any[] = []
    const iterate = config.keepFirst === false ? [...list].reverse() : list

    // The unique panel's "Case Sensitive" switch defaults to ON
    // (`use-unique-config.ts`: `config?.caseSensitive ?? true`), so an absent key
    // has to mean case-SENSITIVE here or the toggle the user sees lies about what
    // the engine does. This is deliberately NOT the filter-level flag that #1551
    // removed — filter operators compare case-insensitively via `evaluateOperator`;
    // dedup keys off an explicit, user-visible choice.
    const caseSensitive = config.caseSensitive ?? true

    for (const item of iterate) {
      let key = this.getNestedValue(item, resolvedField)

      // undefined key = field doesn't exist on this item, pass through
      if (key === undefined) {
        unique.push(item)
        continue
      }

      if (!caseSensitive && typeof key === 'string') {
        key = key.toLowerCase()
      }

      if (!seen.has(key)) {
        seen.add(key)
        unique.push(item)
      }
    }

    return config.keepFirst === false ? unique.reverse() : unique
  }

  /**
   * Join operation - converts array to string with delimiter
   */
  private async executeJoin(list: any[], config: any): Promise<string> {
    const delimiter = config?.delimiter ?? ', '

    // If field is specified, extract that field from each item first
    const values = config?.field
      ? list.map((item) => this.getNestedValue(item, config.field))
      : list

    // Convert all values to strings and join
    return values.map((v) => (v == null ? '' : String(v))).join(delimiter)
  }

  /**
   * Pluck operation implementation
   */
  private async executePluck(list: any[], config: any): Promise<any[]> {
    if (!config || !config.field) return list

    const plucked = list.map((item) => this.getNestedValue(item, config.field))

    if (config.flatten) {
      return plucked.flat()
    }

    return plucked
  }

  /**
   * Helper: Get nested value from object using dot notation
   * Supports custom entity instances which store fields in `fieldValues`
   * Handles ResourceFieldId format (entityDefId:fieldId) by resolving to fieldId
   */
  private getNestedValue(obj: any, path: string): any {
    if (!path) return obj

    // Resolve ResourceFieldId format (e.g., "entityDefId:fieldId") to just the fieldId
    const resolvedPath = path.includes(':') ? this.resolveFilterField(path) : path

    const parts = resolvedPath.split('.')
    let current = obj

    for (const part of parts) {
      if (current == null) return undefined

      // Try direct property access first
      if (current[part] !== undefined) {
        current = current[part]
      }
      // For custom entity instances, check fieldValues if not found at root
      else if (current.fieldValues && current.fieldValues[part] !== undefined) {
        current = current.fieldValues[part]
      } else {
        current = undefined
      }
    }

    return current
  }

  /**
   * Determine which FieldReferences this list operation needs.
   * Used to batch-prefetch field values before operating on ResourceReference arrays.
   *
   * @param entityDefId - Entity definition ID from the ResourceReference
   * @param entityFields - Cached entity field definitions for resolving plain field keys
   */
  private getRequiredFieldRefs(
    data: any,
    entityDefId: string,
    entityFields: ResourceField[]
  ): FieldReference[] {
    const refs: FieldReference[] = []

    switch (data.operation) {
      case 'join':
        if (data.joinConfig?.field) {
          const ref = this.toFieldRef(data.joinConfig.field, entityDefId, entityFields)
          if (ref) refs.push(ref)
        }
        break
      case 'pluck':
        if (data.pluckConfig?.field) {
          const ref = this.toFieldRef(data.pluckConfig.field, entityDefId, entityFields)
          if (ref) refs.push(ref)
        }
        break
      case 'sort':
        if (data.sortConfig?.field) {
          const ref = this.toFieldRef(data.sortConfig.field, entityDefId, entityFields)
          if (ref) refs.push(ref)
        }
        break
      case 'unique':
        if (data.uniqueConfig?.by === 'field' && data.uniqueConfig?.field) {
          const ref = this.toFieldRef(data.uniqueConfig.field, entityDefId, entityFields)
          if (ref) refs.push(ref)
        }
        break
      case 'filter':
        refs.push(...this.extractFilterFieldRefs(data.filterConfig, entityDefId, entityFields))
        break
    }

    return refs
  }

  /**
   * Extract FieldReferences from filter conditions.
   * Preserves full FieldPath for relationship traversal conditions.
   */
  private extractFilterFieldRefs(
    config: any,
    entityDefId: string,
    entityFields: ResourceField[]
  ): FieldReference[] {
    if (!config?.conditions) return []

    return config.conditions
      .map((c: any) => {
        const fieldId = c.fieldId ?? c.field
        if (!fieldId) return null
        return this.toFieldRef(fieldId, entityDefId, entityFields)
      })
      .filter(Boolean) as FieldReference[]
  }

  /**
   * Convert a raw field identifier to a FieldReference.
   * - Array (FieldPath): pass through as-is
   * - String with colon (ResourceFieldId): pass through as-is
   * - Plain string (field key or UUID): resolve to ResourceFieldId using entity fields
   */
  private toFieldRef(
    fieldId: string | string[],
    entityDefId: string,
    entityFields: ResourceField[]
  ): FieldReference | null {
    // FieldPath (relationship traversal)
    if (Array.isArray(fieldId)) {
      return fieldId as FieldPath
    }

    // Already a ResourceFieldId (has colon separator)
    if (fieldId.includes(':')) {
      return fieldId as ResourceFieldId
    }

    // Plain field key or UUID — resolve via entity field definitions
    const field = entityFields.find((f) => f.key === fieldId || f.id === fieldId)
    if (field?.id) {
      return toResourceFieldId(entityDefId, field.id)
    }

    return null
  }

  /**
   * Extract variables from input list and operation-specific fields
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const variables = new Set<string>()

    // Extract from input list
    if (node.data.inputList && typeof node.data.inputList === 'string') {
      this.extractVariableIds(node.data.inputList).forEach((v) => variables.add(v))
    }

    // Join operation no longer extracts from secondList (new string-join implementation)

    // Extract from filter conditions
    if (node.data.operation === 'filter' && node.data.filterConfig?.conditions) {
      node.data.filterConfig.conditions.forEach((condition: any) => {
        if (condition.value && typeof condition.value === 'string') {
          this.extractVariableIds(condition.value).forEach((v) => variables.add(v))
        }
      })
    }

    // Extract from slice configuration
    if (node.data.operation === 'slice' && node.data.sliceConfig) {
      const config = node.data.sliceConfig

      // Extract count variable if not constant
      if (!(config.isCountConstant ?? true) && config.count && typeof config.count === 'string') {
        this.extractVariableIds(config.count).forEach((v) => variables.add(v))
      }

      // Extract start variable if not constant
      if (!(config.isStartConstant ?? true) && config.start && typeof config.start === 'string') {
        this.extractVariableIds(config.start).forEach((v) => variables.add(v))
      }

      // Extract end variable if not constant
      if (!(config.isEndConstant ?? true) && config.end && typeof config.end === 'string') {
        this.extractVariableIds(config.end).forEach((v) => variables.add(v))
      }
    }

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    if (!node.data.operation) {
      errors.push('Operation is required')
    }

    if (!node.data.inputList) {
      errors.push('Input list is required')
    }

    // Operation-specific validation
    switch (node.data.operation) {
      case 'filter': {
        const conditions = node.data.filterConfig?.conditions
        if (!conditions || conditions.length === 0) {
          errors.push('At least one condition is required')
        } else {
          // An operator the registry doesn't know evaluates to "no match" for every
          // item, which reads as an empty result rather than a broken config — so say so.
          conditions.forEach((condition: any, index: number) => {
            if (!condition?.operator) {
              errors.push(`Condition ${index + 1}: Missing operator`)
            } else if (!isKnownOperator(condition.operator)) {
              errors.push(`Condition ${index + 1}: Unknown operator "${condition.operator}"`)
            }
          })
        }
        break
      }

      case 'sort':
        if (!node.data.sortConfig?.field) {
          errors.push('Sort field is required')
        }
        break

      case 'join':
        // No required fields - delimiter defaults to ", "
        break

      case 'pluck':
        if (!node.data.pluckConfig?.field) {
          errors.push('Pluck field is required')
        }
        break

      case 'unique':
        if (node.data.uniqueConfig?.by === 'field' && !node.data.uniqueConfig?.field) {
          errors.push('Unique field is required when deduplicating by field')
        }
        break
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
