// packages/sdk/src/root/schema/array-node.ts

import { BaseSchemaNode, type BaseSchemaOptions } from './base-node.js'

/**
 * Options for array schema fields
 */
export interface ArraySchemaOptions extends BaseSchemaOptions {
  /** Type of array items */
  items: BaseSchemaNode
  /** Minimum number of items */
  minItems?: number
  /** Maximum number of items */
  maxItems?: number
  /** Default value */
  default?: any[]
}

/**
 * Array schema field node
 */
export class SchemaArrayNode<TItem extends BaseSchemaNode = BaseSchemaNode> extends BaseSchemaNode<
  'array',
  any[],
  ArraySchemaOptions
> {
  get type(): 'array' {
    return 'array'
  }

  /**
   * Mark this array field as optional
   */
  optional(): SchemaArrayNode<TItem> {
    return new SchemaArrayNode<TItem>({
      ...this._options,
      isOptional: true,
    })
  }

  /**
   * Get the item type for this array
   */
  get itemType(): BaseSchemaNode {
    return this._options.items
  }

  /**
   * Override toJSON to include item type definition
   */
  toJSON() {
    const base = super.toJSON()

    return {
      ...base,
      items: this._options.items.toJSON(),
    }
  }
}

/**
 * Create a new array schema field
 *
 * @example
 * ```typescript
 * import { array, string, struct } from '@auxx/sdk/schema'
 *
 * const tagsField = array({
 *   label: 'Tags',
 *   description: 'List of tags',
 *   items: string(),
 *   minItems: 0,
 *   maxItems: 10
 * })
 *
 * const emailsField = array({
 *   label: 'Email Addresses',
 *   items: string({
 *     pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
 *   })
 * })
 *
 * const usersField = array({
 *   label: 'Users',
 *   items: struct({
 *     name: string({ label: 'Name' }),
 *     email: string({ label: 'Email' })
 *   })
 * })
 * ```
 */
export function array<TItem extends BaseSchemaNode>(
  options: ArraySchemaOptions & { items: TItem }
): SchemaArrayNode<TItem> {
  return new SchemaArrayNode<TItem>(options)
}
