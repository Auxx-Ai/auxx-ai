// packages/lib/src/workflow-engine/nodes/transform-nodes/list-processor.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import type { SortConfig } from '../types/list-types'

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

      // Execute the appropriate operation
      let result: any
      const metadata: Record<string, any> = {}

      switch (node.data.operation) {
        case 'filter':
          result = await this.executeFilter(inputList, node.data.filterConfig, contextManager)
          metadata.count = result.length
          break

        case 'sort':
          result = await this.executeSort(inputList, node.data.sortConfig)
          break

        // case 'map':
        //   result = await this.executeMap(inputList, node.data.mapConfig, contextManager)
        //   break

        // case 'reduce':
        //   result = await this.executeReduce(inputList, node.data.reduceConfig, contextManager)
        //   if (node.data.reduceConfig?.type === 'count') {
        //     metadata.count = result
        //   }
        //   break

        case 'slice':
          result = await this.executeSlice(inputList, node.data.sliceConfig, contextManager)
          metadata.count = Array.isArray(result) ? result.length : 1
          break

        case 'unique':
          result = await this.executeUnique(inputList, node.data.uniqueConfig)
          metadata.count = result.length
          break

        // case 'group':
        //   result = await this.executeGroup(inputList, node.data.groupConfig)
        //   metadata.groups = result
        //   break

        // case 'find':
        //   result = await this.executeFind(inputList, node.data.findConfig, contextManager)
        //   metadata.count = Array.isArray(result) ? result.length : result ? 1 : 0
        //   break

        case 'join':
          result = await this.executeJoin(inputList, node.data.joinConfig)
          break

        case 'pluck':
          result = await this.executePluck(inputList, node.data.pluckConfig)
          break

        // case 'flatten':
        //   result = await this.executeFlatten(inputList, node.data.flattenConfig)
        //   break

        case 'reverse':
          result = [...inputList].reverse()
          break

        default:
          throw new Error(`Unknown operation: ${node.data.operation}`)
      }

      // Set output variables with proper node scoping
      // This allows subsequent nodes to access as nodeId.result (e.g., list-xxx.result)
      contextManager.setNodeVariable(node.nodeId, 'result', result)

      // Set operation-specific metadata with node scoping
      Object.entries(metadata).forEach(([key, value]) => {
        contextManager.setNodeVariable(node.nodeId, key, value)
      })

      contextManager.log(
        'INFO',
        node.name,
        `List operation completed. Result type: ${Array.isArray(result) ? 'array' : typeof result}`
      )

      return {
        status: NodeRunningStatus.Succeeded,
        output: { result, ...metadata },
        outputHandle: 'source', // Standard output for transform nodes
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      contextManager.log('ERROR', node.name, `List operation failed: ${errorMessage}`)

      return {
        status: NodeRunningStatus.Failed,
        error: errorMessage,
        outputHandle: 'error', // Error output handle
      }
    }
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

    return list.filter((item) => {
      const results = config.conditions.map((condition: any) => {
        const fieldValue = this.getNestedValue(item, condition.field)
        return this.evaluateCondition(
          fieldValue,
          condition.operator,
          condition.value,
          condition.caseSensitive
        )
      })

      return config.logic === 'AND' ? results.every((r) => r) : results.some((r) => r)
    })
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
   * Map operation implementation
   */
  // private async executeMap(
  //   list: any[],
  //   config: any,
  //   contextManager: ExecutionContextManager,
  // ): Promise<any[]> {
  //   if (!config) return list

  //   switch (config.mode) {
  //     case 'template': {
  //       if (!config.template) return list

  //       // Process all items in parallel
  //       const templatePromises = list.map(async (item) => {
  //         // Replace {{item}} placeholder with actual item
  //         const template = config.template.replace(/\{\{item\}\}/g, JSON.stringify(item))
  //         return await this.interpolateVariables(template, contextManager)
  //       })

  //       return await Promise.all(templatePromises)
  //     }

  //     case 'extract':
  //       if (!config.extractFields || config.extractFields.length === 0) return list
  //       return list.map((item) => {
  //         const extracted: any = {}
  //         config.extractFields.forEach((field: string) => {
  //           extracted[field] = this.getNestedValue(item, field)
  //         })
  //         return extracted
  //       })

  //     case 'transform':
  //       // TODO: Implement transformations
  //       return list

  //     default:
  //       return list
  //   }
  // }

  /**
   * Reduce operation implementation
   */
  // private async executeReduce(
  //   list: any[],
  //   config: any,
  //   contextManager: ExecutionContextManager
  // ): Promise<any> {
  //   if (!config || !config.type) return null

  //   switch (config.type) {
  //     case 'sum':
  //       if (!config.field) return 0
  //       return list.reduce((sum, item) => {
  //         const value = this.getNestedValue(item, config.field)
  //         return sum + (typeof value === 'number' ? value : 0)
  //       }, 0)

  //     case 'average':
  //       if (!config.field || list.length === 0) return 0
  //       const sum = list.reduce((sum, item) => {
  //         const value = this.getNestedValue(item, config.field)
  //         return sum + (typeof value === 'number' ? value : 0)
  //       }, 0)
  //       return sum / list.length

  //     case 'min':
  //       if (!config.field || list.length === 0) return null
  //       return list.reduce((min, item) => {
  //         const value = this.getNestedValue(item, config.field)
  //         if (typeof value === 'number' && (min === null || value < min)) {
  //           return value
  //         }
  //         return min
  //       }, null)

  //     case 'max':
  //       if (!config.field || list.length === 0) return null
  //       return list.reduce((max, item) => {
  //         const value = this.getNestedValue(item, config.field)
  //         if (typeof value === 'number' && (max === null || value > max)) {
  //           return value
  //         }
  //         return max
  //       }, null)

  //     case 'count':
  //       return list.length

  //     case 'concat':
  //       const separator = config.separator || ''
  //       return list
  //         .map((item) => (config.field ? this.getNestedValue(item, config.field) : item))
  //         .join(separator)

  //     case 'custom':
  //       // TODO: Implement custom reduce with expression
  //       return null

  //     default:
  //       return null
  //   }
  // }

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

    const seen = new Set()
    const unique: any[] = []

    for (const item of list) {
      const key =
        config.by === 'field' && config.field
          ? this.getNestedValue(item, config.field)
          : JSON.stringify(item)

      if (!seen.has(key)) {
        seen.add(key)
        unique.push(item)
      } else if (!config.keepFirst) {
        // If not keeping first, replace with latest
        const index = unique.findIndex((u) => {
          const uKey =
            config.by === 'field' && config.field
              ? this.getNestedValue(u, config.field)
              : JSON.stringify(u)
          return uKey === key
        })
        if (index !== -1) {
          unique[index] = item
        }
      }
    }

    return unique
  }

  /**
   * Group operation implementation
   */
  // private async executeGroup(list: any[], config: any): Promise<Record<string, any>> {
  //   if (!config || !config.field) return {}

  //   const groups: Record<string, any> = {}

  //   for (const item of list) {
  //     const key = String(this.getNestedValue(item, config.field))

  //     if (!groups[key]) {
  //       groups[key] = { items: [], count: 0 }
  //     }

  //     groups[key].items.push(item)
  //     groups[key].count++

  //     // Apply aggregations if specified
  //     if (config.aggregations) {
  //       // TODO: Implement aggregations
  //     }
  //   }

  //   return groups
  // }

  /**
   * Find operation implementation
   */
  // private async executeFind(
  //   list: any[],
  //   config: any,
  //   contextManager: ExecutionContextManager
  // ): Promise<any> {
  //   if (!config || !config.conditions || config.conditions.length === 0) {
  //     return config.mode === 'all' ? list : null
  //   }

  //   const matches = await this.executeFilter(list, config, contextManager)

  //   switch (config.mode) {
  //     case 'first':
  //       return matches[0] || null
  //     case 'last':
  //       return matches[matches.length - 1] || null
  //     case 'all':
  //       return matches
  //     default:
  //       return null
  //   }
  // }

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
   * Flatten operation implementation
   */
  // private async executeFlatten(list: any[], config: any): Promise<any[]> {
  //   if (!config || config.depth === undefined) return list

  //   const depth = config.depth === 'infinite' ? Infinity : config.depth
  //   return list.flat(depth)
  // }

  /**
   * Helper: Get nested value from object using dot notation
   * Supports custom entity instances which store fields in `fieldValues`
   */
  private getNestedValue(obj: any, path: string): any {
    if (!path) return obj

    const parts = path.split('.')
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
   * Helper: Evaluate a condition
   */
  private evaluateCondition(
    value: any,
    operator: string,
    compareValue: any,
    caseSensitive?: boolean
  ): boolean {
    // Handle null/undefined checks first
    if (operator === 'is_null') return value == null
    if (operator === 'is_not_null') return value != null
    if (operator === 'is_empty') {
      return (
        value === '' ||
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'object' && Object.keys(value).length === 0)
      )
    }
    if (operator === 'is_not_empty') {
      return !this.evaluateCondition(value, 'is_empty', null)
    }

    // Convert values for comparison
    let val = value
    let cmp = compareValue

    // Handle string comparisons
    if (typeof val === 'string' || typeof cmp === 'string') {
      val = String(val)
      cmp = String(cmp)

      if (!caseSensitive) {
        val = val.toLowerCase()
        cmp = cmp.toLowerCase()
      }
    }

    // Evaluate operators
    switch (operator) {
      case 'equals':
        return val === cmp
      case 'not_equals':
        return val !== cmp
      case 'contains':
        return String(val).includes(String(cmp))
      case 'not_contains':
        return !String(val).includes(String(cmp))
      case 'greater_than':
        return Number(val) > Number(cmp)
      case 'less_than':
        return Number(val) < Number(cmp)
      case 'greater_than_or_equal':
        return Number(val) >= Number(cmp)
      case 'less_than_or_equal':
        return Number(val) <= Number(cmp)
      default:
        return false
    }
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

    // Extract from map template
    if (node.data.operation === 'map' && node.data.mapConfig?.template) {
      this.extractVariableIds(node.data.mapConfig.template).forEach((v) => variables.add(v))
    }

    // Join operation no longer extracts from secondList (new string-join implementation)

    // Extract from filter conditions
    if (
      (node.data.operation === 'filter' || node.data.operation === 'find') &&
      node.data.filterConfig?.conditions
    ) {
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
      case 'filter':
      case 'find': {
        const conditions =
          node.data.operation === 'filter'
            ? node.data.filterConfig?.conditions
            : node.data.findConfig?.conditions
        if (!conditions || conditions.length === 0) {
          errors.push('At least one condition is required')
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
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
