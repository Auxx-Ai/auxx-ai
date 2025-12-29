// packages/sdk/src/root/schema/number-node.ts

import { BaseSchemaNode, type BaseSchemaOptions } from './base-node.js'

/**
 * Options for number schema fields
 * Supports all options from both settings (step) and workflow (integer, precision)
 */
export interface NumberSchemaOptions extends BaseSchemaOptions {
  /** Default value for number field */
  default?: number
  /** Minimum value */
  min?: number
  /** Maximum value */
  max?: number
  /** Step increment (for UI controls) */
  step?: number
  /** Must be integer */
  integer?: boolean
  /** Decimal precision */
  precision?: number
  /** Placeholder text */
  placeholder?: string
}

/**
 * Number schema field node
 */
export class SchemaNumberNode extends BaseSchemaNode<'number', number, NumberSchemaOptions> {
  get type(): 'number' {
    return 'number'
  }

  /**
   * Mark this number field as optional
   */
  optional(): SchemaNumberNode {
    return new SchemaNumberNode({
      ...this._options,
      isOptional: true,
    })
  }
}

/**
 * Create a new number schema field
 *
 * @example
 * ```typescript
 * import { number } from '@auxx/sdk/schema'
 *
 * const ageField = number({
 *   label: 'Age',
 *   description: 'User age',
 *   min: 0,
 *   max: 120,
 *   integer: true,
 *   default: 18
 * })
 *
 * const priceField = number({
 *   label: 'Price',
 *   min: 0,
 *   precision: 2
 * })
 *
 * const maxRetries = number({
 *   label: 'Max Retries',
 *   default: 3,
 *   min: 0,
 *   max: 10,
 *   step: 1
 * })
 * ```
 */
export function number(options?: NumberSchemaOptions): SchemaNumberNode {
  return new SchemaNumberNode(options)
}
