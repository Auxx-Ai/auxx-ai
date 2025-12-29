// packages/sdk/src/root/schema/base-node.ts

/**
 * Common options for all schema field types
 * Used by both settings and workflow systems
 */
export interface BaseSchemaOptions<TValue = unknown> {
  /** Display label for the field */
  label?: string
  /** Description/help text for the field */
  description?: string
  /** Default value for the field */
  default?: TValue
  /** Whether the field is required */
  required?: boolean
  /** Whether the field is optional (can be undefined) */
  isOptional?: boolean
}

/**
 * Base class for all schema field nodes
 * Shared implementation for both settings and workflows
 */
export abstract class BaseSchemaNode<
  TType extends string = string,
  TValue = unknown,
  TOptions extends BaseSchemaOptions<TValue> = BaseSchemaOptions<TValue>,
> {
  protected _options: TOptions

  constructor(options?: TOptions) {
    this._options = (options || {}) as TOptions
  }

  /**
   * Get the type of this field node
   */
  abstract get type(): TType

  /**
   * Get the options for this field node
   */
  get options(): TOptions {
    return this._options
  }

  /**
   * Mark this field as optional (can be undefined)
   * Returns a new node instance with isOptional: true
   */
  abstract optional(): any

  /**
   * Check if this field is optional
   */
  get isOptional(): boolean {
    return this._options.isOptional === true
  }

  /**
   * Serialize to JSON format
   * Maps user-friendly options to metadata structure
   */
  toJSON(): {
    type: TType
    isOptional?: boolean
    _metadata?: {
      label?: string
      description?: string
      defaultValue?: TValue
      required?: boolean
      format?: string
      [key: string]: any
    }
  } {
    const { default: defaultValue, label, description, required, isOptional, ...rest } =
      this._options

    const metadata: Record<string, unknown> = {}

    if (label !== undefined) metadata.label = label
    if (description !== undefined) metadata.description = description
    if (defaultValue !== undefined) metadata.defaultValue = defaultValue
    if (required !== undefined) metadata.required = required

    // Serialize format if present
    if ('format' in rest && rest.format !== undefined) {
      metadata.format = rest.format as string
    }

    // Include all other options in metadata
    for (const key in rest) {
      if (key !== 'format' && rest[key as keyof typeof rest] !== undefined) {
        metadata[key] = rest[key as keyof typeof rest]
      }
    }

    const result: {
      type: TType
      isOptional?: boolean
      _metadata?: Record<string, unknown>
    } = {
      type: this.type,
    }

    // Runtime validation: ensure type is always defined
    if (!result.type) {
      console.error('[SDK] Field node missing type!', {
        constructor: this.constructor.name,
        options: this._options,
      })
      throw new Error(`Field node missing type property: ${this.constructor.name}`)
    }

    if (isOptional === true) {
      result.isOptional = true
    }

    if (Object.keys(metadata).length > 0) {
      result._metadata = metadata
    }

    return result
  }
}
