// packages/sdk/src/root/workflow/input-nodes.ts

import { WorkflowFieldNode, type BaseWorkflowFieldOptions } from './base-node.js'
import type { SelectOption } from '../schema/select-node.js'
import type { TransformationContext } from './values/types.js'

// ============================================================================
// Input Field Options Interfaces
// ============================================================================

/**
 * Options for string input fields
 */
export interface StringInputOptions extends BaseWorkflowFieldOptions {
  default?: string
  minLength?: number
  maxLength?: number
  pattern?: string
  placeholder?: string
}

/**
 * Options for number input fields
 */
export interface NumberInputOptions extends BaseWorkflowFieldOptions {
  default?: number
  min?: number
  max?: number
  integer?: boolean
  precision?: number
  placeholder?: string
}

/**
 * Options for boolean input fields
 */
export interface BooleanInputOptions extends BaseWorkflowFieldOptions {
  default?: boolean
}

/**
 * Options for select input fields
 */
export interface SelectInputOptions extends BaseWorkflowFieldOptions {
  options: readonly SelectOption[]
  default?: string
}

/**
 * Options for array input fields
 */
export interface ArrayInputOptions extends BaseWorkflowFieldOptions {
  items: WorkflowFieldNode
  minItems?: number
  maxItems?: number
  default?: any[]
}

/**
 * Options for struct input fields
 */
export interface StructInputOptions<TValue = Record<string, any>>
  extends BaseWorkflowFieldOptions<TValue> {
  fields: Record<string, WorkflowFieldNode>
}

// ============================================================================
// Input Field Node Classes
// ============================================================================

/**
 * String input field node
 */
export class WorkflowStringNode extends WorkflowFieldNode<'string', string, StringInputOptions> {
  get type(): 'string' {
    return 'string'
  }

  optional(): WorkflowStringNode {
    return new WorkflowStringNode({ ...this._options, isOptional: true })
  }
}

/**
 * Number input field node
 */
export class WorkflowNumberNode extends WorkflowFieldNode<'number', number, NumberInputOptions> {
  get type(): 'number' {
    return 'number'
  }

  optional(): WorkflowNumberNode {
    return new WorkflowNumberNode({ ...this._options, isOptional: true })
  }
}

/**
 * Boolean input field node
 */
export class WorkflowBooleanNode extends WorkflowFieldNode<'boolean', boolean, BooleanInputOptions> {
  get type(): 'boolean' {
    return 'boolean'
  }

  optional(): WorkflowBooleanNode {
    return new WorkflowBooleanNode({ ...this._options, isOptional: true })
  }
}

/**
 * Select input field node
 */
export class WorkflowSelectNode<TOptions extends readonly SelectOption[] = readonly SelectOption[]>
  extends WorkflowFieldNode<'select', string, SelectInputOptions> {
  get type(): 'select' {
    return 'select'
  }

  optional(): WorkflowSelectNode<TOptions> {
    return new WorkflowSelectNode<TOptions>({ ...this._options, isOptional: true })
  }

  get selectOptions(): readonly SelectOption[] {
    return this._options.options
  }

  toJSON() {
    const base = super.toJSON()
    if (!base._metadata) base._metadata = {}
    base._metadata.options = this._options.options as unknown as SelectOption[]
    return base
  }
}

/**
 * Array input field node
 */
export class WorkflowArrayNode<TItem extends WorkflowFieldNode = WorkflowFieldNode>
  extends WorkflowFieldNode<'array', any[], ArrayInputOptions> {
  get type(): 'array' {
    return 'array'
  }

  optional(): WorkflowArrayNode<TItem> {
    return new WorkflowArrayNode<TItem>({ ...this._options, isOptional: true })
  }

  get itemType(): WorkflowFieldNode {
    return this._options.items
  }

  toJSON() {
    const base = super.toJSON()
    if (base._metadata && 'items' in base._metadata) {
      delete base._metadata.items
    }
    return { ...base, items: this._options.items.toJSON() }
  }

  /**
   * Transform array items recursively
   */
  async toConfig(value: any[], context: TransformationContext): Promise<any[]> {
    if (!Array.isArray(value)) return value
    return Promise.all(value.map((item) => this._options.items.toConfig(item, context)))
  }

  async toRuntimeValue(value: any[], context: TransformationContext): Promise<any[]> {
    if (!Array.isArray(value)) return value
    return Promise.all(value.map((item) => this._options.items.toRuntimeValue(item, context)))
  }

  serialize(value: any[]): any[] {
    if (!Array.isArray(value)) return value
    return value.map((item) => this._options.items.serialize(item))
  }

  deserialize(value: any[]): any[] {
    if (!Array.isArray(value)) return value
    return value.map((item) => this._options.items.deserialize(item))
  }
}

/**
 * Struct input field node (for nested objects)
 */
export class WorkflowStructNode<TFields extends Record<string, WorkflowFieldNode> = Record<string, WorkflowFieldNode>>
  extends WorkflowFieldNode<'struct', Record<string, any>, StructInputOptions<Record<string, any>>> {
  constructor(fields: TFields, options?: Omit<StructInputOptions<Record<string, any>>, 'fields'>) {
    super({ ...options, fields } as StructInputOptions<Record<string, any>>)
  }

  get type(): 'struct' {
    return 'struct'
  }

  optional(): WorkflowStructNode<TFields> {
    return new WorkflowStructNode<TFields>(this._options.fields as TFields, {
      ...this._options,
      isOptional: true,
    })
  }

  get fields(): TFields {
    return this._options.fields as TFields
  }

  toJSON() {
    const base = super.toJSON()
    const serializedFields: Record<string, any> = {}
    for (const [key, field] of Object.entries(this._options.fields)) {
      serializedFields[key] = field.toJSON()
    }
    if (base._metadata && 'fields' in base._metadata) {
      delete base._metadata.fields
    }
    return { ...base, fields: serializedFields }
  }

  /**
   * Transform struct fields recursively
   */
  async toConfig(
    value: Record<string, any>,
    context: TransformationContext
  ): Promise<Record<string, any>> {
    if (!value || typeof value !== 'object') return value

    const result: Record<string, any> = {}
    for (const [key, field] of Object.entries(this._options.fields)) {
      if (key in value) {
        result[key] = await field.toConfig(value[key], context)
      }
    }
    return result
  }

  async toRuntimeValue(
    value: Record<string, any>,
    context: TransformationContext
  ): Promise<Record<string, any>> {
    if (!value || typeof value !== 'object') return value

    const result: Record<string, any> = {}
    for (const [key, field] of Object.entries(this._options.fields)) {
      if (key in value) {
        result[key] = await field.toRuntimeValue(value[key], context)
      }
    }
    return result
  }

  serialize(value: Record<string, any>): Record<string, any> {
    if (!value || typeof value !== 'object') return value

    const result: Record<string, any> = {}
    for (const [key, field] of Object.entries(this._options.fields)) {
      if (key in value) {
        result[key] = field.serialize(value[key])
      }
    }
    return result
  }

  deserialize(value: Record<string, any>): Record<string, any> {
    if (!value || typeof value !== 'object') return value

    const result: Record<string, any> = {}
    for (const [key, field] of Object.entries(this._options.fields)) {
      if (key in value) {
        result[key] = field.deserialize(value[key])
      }
    }
    return result
  }
}

// ============================================================================
// Input Field Factory Functions
// ============================================================================

/**
 * Create a string input field
 *
 * @example
 * ```typescript
 * Workflow.string({
 *   label: 'Email Address',
 *   placeholder: 'user@example.com',
 *   acceptsVariables: true,
 * })
 * ```
 */
export function string(options?: StringInputOptions): WorkflowStringNode {
  return new WorkflowStringNode(options)
}

/**
 * Create a number input field
 *
 * @example
 * ```typescript
 * Workflow.number({
 *   label: 'Max Retries',
 *   min: 0,
 *   max: 10,
 *   default: 3,
 * })
 * ```
 */
export function number(options?: NumberInputOptions): WorkflowNumberNode {
  return new WorkflowNumberNode(options)
}

/**
 * Create a boolean input field
 *
 * @example
 * ```typescript
 * Workflow.boolean({
 *   label: 'Enable Feature',
 *   default: false,
 * })
 * ```
 */
export function boolean(options?: BooleanInputOptions): WorkflowBooleanNode {
  return new WorkflowBooleanNode(options)
}

/**
 * Create a select input field
 *
 * @example
 * ```typescript
 * Workflow.select({
 *   label: 'Priority',
 *   options: [
 *     { value: 'low', label: 'Low' },
 *     { value: 'high', label: 'High' },
 *   ],
 *   default: 'low',
 * })
 * ```
 */
export function select<TOptions extends readonly SelectOption[]>(
  options: SelectInputOptions & { options: TOptions }
): WorkflowSelectNode<TOptions> {
  return new WorkflowSelectNode<TOptions>(options)
}

/**
 * Create an array input field
 *
 * @example
 * ```typescript
 * Workflow.array({
 *   label: 'Tags',
 *   items: Workflow.string({ label: 'Tag' }),
 *   minItems: 1,
 * })
 * ```
 */
export function array<TItem extends WorkflowFieldNode>(
  options: ArrayInputOptions & { items: TItem }
): WorkflowArrayNode<TItem> {
  return new WorkflowArrayNode<TItem>(options)
}

/**
 * Create a struct input field for nested objects
 *
 * @example
 * ```typescript
 * Workflow.struct({
 *   name: Workflow.string({ label: 'Name' }),
 *   age: Workflow.number({ label: 'Age' }),
 * }, {
 *   label: 'Person',
 * })
 * ```
 */
export function struct<TFields extends Record<string, WorkflowFieldNode>>(
  fields: TFields,
  options?: Omit<StructInputOptions, 'fields'>
): WorkflowStructNode<TFields> {
  return new WorkflowStructNode<TFields>(fields, options)
}
