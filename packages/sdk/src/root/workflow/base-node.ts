// packages/sdk/src/root/workflow/base-node.ts

import { BaseSchemaNode, type BaseSchemaOptions } from '../schema/base-node.js'
import type { TransformationContext } from './values/types.js'

/**
 * Workflow-specific field options
 * Extends base schema options with workflow variable support
 */
export interface BaseWorkflowFieldOptions<TValue = unknown> extends BaseSchemaOptions<TValue> {
  /** Whether this field accepts workflow variables (e.g., {{node.output}}) */
  acceptsVariables?: boolean
  /** Allowed variable types when acceptsVariables is true */
  variableTypes?: string[]
}

/**
 * Base class for all workflow field nodes
 * Extends the shared schema base with workflow-specific functionality
 */
export abstract class WorkflowFieldNode<
  TType extends string = string,
  TValue = unknown,
  TOptions extends BaseWorkflowFieldOptions<TValue> = BaseWorkflowFieldOptions<TValue>,
> extends BaseSchemaNode<TType, TValue, TOptions> {
  /**
   * Check if this field accepts workflow variables
   */
  get acceptsVariables(): boolean {
    return this._options.acceptsVariables === true
  }

  /**
   * Get allowed variable types for this field
   */
  get variableTypes(): string[] | undefined {
    return this._options.variableTypes
  }

  /**
   * Serialize to JSON format
   * Extends base serialization with workflow-specific fields
   */
  toJSON(): {
    type: TType
    isOptional?: boolean
    acceptsVariables?: boolean
    variableTypes?: string[]
    _metadata?: {
      label?: string
      description?: string
      defaultValue?: TValue
      required?: boolean
      [key: string]: any
    }
  } {
    const base = super.toJSON()
    const { acceptsVariables, variableTypes } = this._options

    const result: any = { ...base }

    if (acceptsVariables === true) {
      result.acceptsVariables = true
    }

    if (variableTypes !== undefined && variableTypes.length > 0) {
      result.variableTypes = variableTypes
    }

    return result
  }

  /**
   * Serialize value for iframe postMessage
   * Default: pass through (primitives override if needed)
   */
  serialize(value: TValue): any {
    return value
  }

  /**
   * Deserialize value from iframe postMessage
   * Default: pass through (primitives override if needed)
   */
  deserialize(value: any): TValue {
    return value
  }

  /**
   * Transform to config format for database storage
   * Default: pass through (entity types override with UUID resolution)
   */
  toConfig(value: TValue | any, _context: TransformationContext): Promise<any> | any {
    return value
  }

  /**
   * Transform to runtime format for Lambda execution
   * Default: pass through (entity types override with full object resolution)
   */
  toRuntimeValue(value: any, _context: TransformationContext): Promise<TValue> | TValue {
    return value
  }
}
