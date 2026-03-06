// packages/sdk/src/root/workflow/input-nodes.ts

import type { SelectOption } from '../schema/select-node.js'
import { type BaseWorkflowFieldOptions, WorkflowFieldNode } from './base-node.js'
import type { TransformationContext } from './values/types.js'

// ============================================================================
// Input Field Options Interfaces
// ============================================================================

/**
 * Supported string formats for workflow string fields
 */
export type WorkflowStringFormat = 'date' | 'datetime' | 'time' | 'email' | 'url' | 'phone'

/**
 * Options for string input fields
 */
export interface StringInputOptions extends BaseWorkflowFieldOptions {
  default?: string
  minLength?: number
  maxLength?: number
  pattern?: string
  placeholder?: string
  /** Format hint for specialized string types */
  format?: WorkflowStringFormat
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
  default?: string | string[]
  /** Allow selecting multiple options (default: false) */
  multi?: boolean
}

/**
 * Options for array input fields
 */
export interface ArrayInputOptions extends BaseWorkflowFieldOptions {
  items: WorkflowFieldNode
  minItems?: number
  maxItems?: number
  default?: any[]
  /** Predefined options — renders as MultiSelect picker instead of plain ArrayInput */
  options?: readonly SelectOption[]
  /** Allow user to create new options at runtime (default: false) */
  canAdd?: boolean
  /** Allow user to edit/delete options at runtime (default: false) */
  canManage?: boolean
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
export class WorkflowBooleanNode extends WorkflowFieldNode<
  'boolean',
  boolean,
  BooleanInputOptions
> {
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
export class WorkflowSelectNode<
  TOptions extends readonly SelectOption[] = readonly SelectOption[],
> extends WorkflowFieldNode<'select', string | string[], SelectInputOptions> {
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
    if (this._options.multi) {
      base._metadata.multi = true
    }
    return base
  }
}

/**
 * Array input field node
 */
export class WorkflowArrayNode<
  TItem extends WorkflowFieldNode = WorkflowFieldNode,
> extends WorkflowFieldNode<'array', any[], ArrayInputOptions> {
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
    const result: any = { ...base, items: this._options.items.toJSON() }
    if (this._options.options) {
      if (!result._metadata) result._metadata = {}
      result._metadata.options = this._options.options as unknown as SelectOption[]
      result._metadata.canAdd = this._options.canAdd ?? false
      result._metadata.canManage = this._options.canManage ?? false
    }
    return result
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
export class WorkflowStructNode<
  TFields extends Record<string, WorkflowFieldNode> = Record<string, WorkflowFieldNode>,
> extends WorkflowFieldNode<
  'struct',
  Record<string, any>,
  StructInputOptions<Record<string, any>>
> {
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

/**
 * Options for object input fields
 */
export interface ObjectInputOptions extends BaseWorkflowFieldOptions {
  default?: Record<string, unknown>
  placeholder?: string
}

/**
 * Options for currency input fields
 */
export interface CurrencyInputOptions extends BaseWorkflowFieldOptions {
  default?: number
  /** ISO 4217 currency code (default: 'USD') */
  currencyCode?: string
  /** Number of decimal places (default: 2) */
  decimalPlaces?: number
  placeholder?: string
}

/**
 * Options for secret input fields
 */
export interface SecretInputOptions extends BaseWorkflowFieldOptions {
  default?: string
  placeholder?: string
}

/**
 * Options for file input fields
 */
export interface FileInputOptions
  extends BaseWorkflowFieldOptions<WorkflowFileData | WorkflowFileData[]> {
  /** Allow multiple file uploads (default: false) */
  allowMultiple?: boolean
  /** Maximum number of files when allowMultiple is true */
  maxFiles?: number
  /** Allowed MIME types or file extensions */
  allowedFileTypes?: string[]
  placeholder?: string
}

/**
 * Structured file data in workflow context
 */
export interface WorkflowFileData {
  id: string
  fileId: string
  assetId: string
  versionId: string
  filename: string
  mimeType: string
  size: number
  url: string
  nodeId: string
  uploadedAt: Date
  expiresAt?: Date
}

// ============================================================================
// New Input Field Node Classes
// ============================================================================

/**
 * Object input field node (arbitrary untyped object)
 */
export class WorkflowObjectNode extends WorkflowFieldNode<
  'object',
  Record<string, unknown>,
  ObjectInputOptions
> {
  get type(): 'object' {
    return 'object'
  }

  optional(): WorkflowObjectNode {
    return new WorkflowObjectNode({ ...this._options, isOptional: true })
  }
}

/**
 * Currency input field node (integer cents)
 */
export class WorkflowCurrencyNode extends WorkflowFieldNode<
  'currency',
  number,
  CurrencyInputOptions
> {
  get type(): 'currency' {
    return 'currency'
  }

  optional(): WorkflowCurrencyNode {
    return new WorkflowCurrencyNode({ ...this._options, isOptional: true })
  }

  toJSON() {
    const base = super.toJSON()
    if (!base._metadata) base._metadata = {}
    if (this._options.currencyCode) base._metadata.currencyCode = this._options.currencyCode
    if (this._options.decimalPlaces !== undefined)
      base._metadata.decimalPlaces = this._options.decimalPlaces
    return base
  }
}

/**
 * Secret input field node (masked sensitive value)
 */
export class WorkflowSecretNode extends WorkflowFieldNode<'secret', string, SecretInputOptions> {
  get type(): 'secret' {
    return 'secret'
  }

  optional(): WorkflowSecretNode {
    return new WorkflowSecretNode({ ...this._options, isOptional: true })
  }
}

/**
 * File input field node
 */
export class WorkflowFileNode extends WorkflowFieldNode<
  'file',
  WorkflowFileData | WorkflowFileData[],
  FileInputOptions
> {
  get type(): 'file' {
    return 'file'
  }

  optional(): WorkflowFileNode {
    return new WorkflowFileNode({ ...this._options, isOptional: true })
  }

  toJSON() {
    const base = super.toJSON()
    if (!base._metadata) base._metadata = {}
    if (this._options.allowMultiple) base._metadata.allowMultiple = this._options.allowMultiple
    if (this._options.maxFiles !== undefined) base._metadata.maxFiles = this._options.maxFiles
    if (this._options.allowedFileTypes)
      base._metadata.allowedFileTypes = this._options.allowedFileTypes
    return base
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
 * Create a date string input field (YYYY-MM-DD format)
 */
export function date(options?: Omit<StringInputOptions, 'format'>): WorkflowStringNode {
  return new WorkflowStringNode({ ...options, format: 'date' })
}

/**
 * Create a datetime string input field (ISO 8601 format)
 */
export function datetime(options?: Omit<StringInputOptions, 'format'>): WorkflowStringNode {
  return new WorkflowStringNode({ ...options, format: 'datetime' })
}

/**
 * Create a time string input field (HH:mm:ss format)
 */
export function time(options?: Omit<StringInputOptions, 'format'>): WorkflowStringNode {
  return new WorkflowStringNode({ ...options, format: 'time' })
}

/**
 * Create an email string input field
 */
export function email(options?: Omit<StringInputOptions, 'format'>): WorkflowStringNode {
  return new WorkflowStringNode({ ...options, format: 'email' })
}

/**
 * Create a URL string input field
 */
export function url(options?: Omit<StringInputOptions, 'format'>): WorkflowStringNode {
  return new WorkflowStringNode({ ...options, format: 'url' })
}

/**
 * Create a phone number string input field
 */
export function phone(options?: Omit<StringInputOptions, 'format'>): WorkflowStringNode {
  return new WorkflowStringNode({ ...options, format: 'phone' })
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

/**
 * Create an object input field for arbitrary key-value data
 *
 * @example
 * ```typescript
 * Workflow.object({
 *   label: 'API Payload',
 *   default: {},
 * })
 * ```
 */
export function object(options?: ObjectInputOptions): WorkflowObjectNode {
  return new WorkflowObjectNode(options)
}

/**
 * Create a currency input field (value in cents)
 *
 * @example
 * ```typescript
 * Workflow.currency({
 *   label: 'Price',
 *   currencyCode: 'USD',
 *   decimalPlaces: 2,
 * })
 * ```
 */
export function currency(options?: CurrencyInputOptions): WorkflowCurrencyNode {
  return new WorkflowCurrencyNode(options)
}

/**
 * Create a secret input field (masked in UI, not logged)
 *
 * @example
 * ```typescript
 * Workflow.secret({
 *   label: 'API Key',
 *   placeholder: 'Enter your API key...',
 * })
 * ```
 */
export function secret(options?: SecretInputOptions): WorkflowSecretNode {
  return new WorkflowSecretNode(options)
}

/**
 * Create a file input field
 *
 * @example
 * ```typescript
 * Workflow.file({
 *   label: 'Attachment',
 *   allowMultiple: true,
 *   maxFiles: 5,
 *   allowedFileTypes: ['image/*', 'application/pdf'],
 * })
 * ```
 */
export function file(options?: FileInputOptions): WorkflowFileNode {
  return new WorkflowFileNode(options)
}
