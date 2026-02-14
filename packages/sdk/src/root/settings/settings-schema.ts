// packages/sdk/src/root/settings/settings-schema.ts

import { BaseNode, type BaseSettingOptions } from './base-node.js'

// ============================================================================
// Settings Field Options
// ============================================================================

/**
 * Options for string settings
 */
export interface StringSettingOptions extends BaseSettingOptions {
  default?: string
  minLength?: number
  maxLength?: number
  pattern?: string
  placeholder?: string
}

/**
 * Options for number settings
 */
export interface NumberSettingOptions extends BaseSettingOptions {
  default?: number
  min?: number
  max?: number
  step?: number
  placeholder?: string
}

/**
 * Options for boolean settings
 */
export interface BooleanSettingOptions extends BaseSettingOptions {
  default?: boolean
}

/**
 * Options for select (dropdown) settings
 */
export interface SelectSettingOptions<T extends readonly string[] = readonly string[]>
  extends BaseSettingOptions {
  options: T
  default?: T[number]
}

/**
 * Options for struct (nested object) settings
 */
export interface StructSettingOptions extends BaseSettingOptions {
  default?: never
}

// ============================================================================
// Settings Node Classes
// ============================================================================

/**
 * String setting node
 */
export class SettingsStringNode extends BaseNode<'string', string, StringSettingOptions> {
  get type(): 'string' {
    return 'string'
  }

  optional(): SettingsStringNode {
    return new SettingsStringNode({
      ...this._options,
      isOptional: true,
    })
  }
}

/**
 * Number setting node
 */
export class SettingsNumberNode extends BaseNode<'number', number, NumberSettingOptions> {
  get type(): 'number' {
    return 'number'
  }

  optional(): SettingsNumberNode {
    return new SettingsNumberNode({
      ...this._options,
      isOptional: true,
    })
  }
}

/**
 * Boolean setting node
 */
export class SettingsBooleanNode extends BaseNode<'boolean', boolean, BooleanSettingOptions> {
  get type(): 'boolean' {
    return 'boolean'
  }

  optional(): SettingsBooleanNode {
    return new SettingsBooleanNode({
      ...this._options,
      isOptional: true,
    })
  }
}

/**
 * Select setting node for dropdown/enum values
 */
export class SettingsSelectNode<T extends readonly string[] = readonly string[]> extends BaseNode<
  'select',
  T[number],
  SelectSettingOptions<T>
> {
  get type(): 'select' {
    return 'select'
  }

  optional(): SettingsSelectNode<T> {
    return new SettingsSelectNode({
      ...this._options,
      isOptional: true,
    })
  }

  toJSON() {
    const base = super.toJSON()
    if (!base._metadata) base._metadata = {}
    base._metadata.options = this._options.options as unknown as string[]
    return base
  }
}

/**
 * Struct setting node for grouping related settings
 */
export class SettingsStructNode<
  TFields extends Record<string, any> = Record<string, any>,
> extends BaseNode<'struct', TFields, StructSettingOptions> {
  private _fields: TFields

  constructor(fields: TFields, options?: StructSettingOptions) {
    super(options)
    this._fields = fields
  }

  get type(): 'struct' {
    return 'struct'
  }

  get fields(): TFields {
    return this._fields
  }

  optional(): SettingsStructNode<TFields> {
    return new SettingsStructNode(this._fields, {
      ...this._options,
      isOptional: true,
    })
  }

  toJSON() {
    const base = super.toJSON()
    const serializedFields: Record<string, any> = {}

    for (const [key, value] of Object.entries(this._fields)) {
      if (value && typeof value === 'object' && 'toJSON' in value) {
        serializedFields[key] = value.toJSON()
      } else if (typeof value === 'object' && value !== null) {
        serializedFields[key] = this._serializeObject(value)
      } else {
        serializedFields[key] = value
      }
    }

    return {
      ...base,
      fields: serializedFields,
    }
  }

  private _serializeObject(obj: any): any {
    if (obj && typeof obj === 'object' && 'toJSON' in obj) {
      return obj.toJSON()
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this._serializeObject(item))
    }

    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, any> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this._serializeObject(value)
      }
      return result
    }

    return obj
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new string setting
 */
export function string(options?: StringSettingOptions): SettingsStringNode {
  return new SettingsStringNode(options)
}

/**
 * Create a new number setting
 */
export function number(options?: NumberSettingOptions): SettingsNumberNode {
  return new SettingsNumberNode(options)
}

/**
 * Create a new boolean setting
 */
export function boolean(options?: BooleanSettingOptions): SettingsBooleanNode {
  return new SettingsBooleanNode(options)
}

/**
 * Create a new select (dropdown) setting
 */
export function select<T extends readonly string[]>(
  options: SelectSettingOptions<T>
): SettingsSelectNode<T> {
  return new SettingsSelectNode(options)
}

/**
 * Create a new struct (nested object) setting
 */
export function struct<TFields extends Record<string, any>>(
  fields: TFields,
  options?: StructSettingOptions
): SettingsStructNode<TFields> {
  return new SettingsStructNode(fields, options)
}

// ============================================================================
// Type Utilities
// ============================================================================

// Re-export base node and options
export { BaseNode, type BaseSettingOptions } from './base-node.js'

/**
 * Union type of all setting node types
 */
export type SettingsNode =
  | SettingsBooleanNode
  | SettingsNumberNode
  | SettingsStringNode
  | SettingsSelectNode
  | SettingsStructNode

/**
 * A scoped settings schema (organization or user)
 */
export type ScopedSettingsSchema = Record<string, SettingsNode>

/**
 * Complete settings schema with organization and user scopes
 */
export interface SettingsSchema {
  /** User-level settings */
  user: ScopedSettingsSchema
  /** Organization-level settings */
  organization: ScopedSettingsSchema
}
