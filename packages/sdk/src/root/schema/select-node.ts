// packages/sdk/src/root/schema/select-node.ts

import { BaseSchemaNode, type BaseSchemaOptions } from './base-node.js'

/**
 * Select option definition
 * Supports both simple string options and rich {label, value} objects
 */
export type SelectOption =
  | string
  | {
      label: string
      value: string
    }

/**
 * Options for select schema fields
 */
export interface SelectSchemaOptions extends BaseSchemaOptions {
  /** Select options */
  options: readonly SelectOption[]
  /** Default value */
  default?: string
}

/**
 * Select schema field node
 */
export class SchemaSelectNode<
  TOptions extends readonly SelectOption[] = readonly SelectOption[],
> extends BaseSchemaNode<'select', string, SelectSchemaOptions> {
  get type(): 'select' {
    return 'select'
  }

  /**
   * Mark this select field as optional
   */
  optional(): SchemaSelectNode<TOptions> {
    return new SchemaSelectNode<TOptions>({
      ...this._options,
      isOptional: true,
    })
  }

  /**
   * Get the select options
   */
  get selectOptions(): readonly SelectOption[] {
    return this._options.options
  }

  /**
   * Override toJSON to include options in metadata
   */
  toJSON() {
    const base = super.toJSON()

    // Ensure options are always in metadata
    if (!base._metadata) {
      base._metadata = {}
    }

    base._metadata.options = this._options.options as unknown as SelectOption[]

    return base
  }
}

/**
 * Create a new select schema field
 *
 * @example
 * ```typescript
 * import { select } from '@auxx/sdk/schema'
 *
 * // Simple string options
 * const methodField = select({
 *   label: 'HTTP Method',
 *   description: 'Select HTTP method',
 *   options: ['GET', 'POST', 'PUT', 'DELETE'] as const,
 *   default: 'GET'
 * })
 *
 * // Object options with labels
 * const priorityField = select({
 *   label: 'Priority',
 *   options: [
 *     { label: 'Low', value: 'low' },
 *     { label: 'Medium', value: 'medium' },
 *     { label: 'High', value: 'high' }
 *   ] as const,
 *   default: 'medium'
 * })
 *
 * // Settings-style (backward compatible)
 * const timezone = select({
 *   options: ['UTC', 'America/New_York', 'Europe/London'] as const,
 *   default: 'UTC',
 *   label: 'Timezone'
 * })
 * ```
 */
export function select<TOptions extends readonly SelectOption[]>(
  options: SelectSchemaOptions & { options: TOptions }
): SchemaSelectNode<TOptions> {
  return new SchemaSelectNode<TOptions>(options)
}
