// packages/sdk/src/root/schema/boolean-node.ts

import { BaseSchemaNode, type BaseSchemaOptions } from './base-node.js'

/**
 * Options for boolean schema fields
 */
export interface BooleanSchemaOptions extends BaseSchemaOptions {
  /** Default value for boolean field */
  default?: boolean
}

/**
 * Boolean schema field node
 */
export class SchemaBooleanNode extends BaseSchemaNode<'boolean', boolean, BooleanSchemaOptions> {
  get type(): 'boolean' {
    return 'boolean'
  }

  /**
   * Mark this boolean field as optional
   */
  optional(): SchemaBooleanNode {
    return new SchemaBooleanNode({
      ...this._options,
      isOptional: true,
    })
  }
}

/**
 * Create a new boolean schema field
 *
 * @example
 * ```typescript
 * import { boolean } from '@auxx/sdk/schema'
 *
 * const enabledField = boolean({
 *   label: 'Enabled',
 *   description: 'Enable this feature',
 *   default: false
 * })
 *
 * const debugField = boolean({
 *   label: 'Debug Mode',
 *   default: false
 * }).optional()
 * ```
 */
export function boolean(options?: BooleanSchemaOptions): SchemaBooleanNode {
  return new SchemaBooleanNode(options)
}
