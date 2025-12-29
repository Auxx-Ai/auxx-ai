// packages/sdk/src/root/schema/string-node.ts

import { BaseSchemaNode, type BaseSchemaOptions } from './base-node.js'

/**
 * Supported string formats following JSON Schema spec
 */
export type StringFormat =
  | 'date'      // Date without time (YYYY-MM-DD)
  | 'datetime'  // Date with time (ISO 8601)
  | 'time'      // Time without date (HH:mm:ss)
  | 'email'     // Email address
  | 'url'       // URL
  | 'uri'       // URI

/**
 * Options for string schema fields
 */
export interface StringSchemaOptions extends BaseSchemaOptions {
  /** Default value for string field */
  default?: string
  /** Minimum length */
  minLength?: number
  /** Maximum length */
  maxLength?: number
  /** Regex pattern for validation */
  pattern?: string
  /** Placeholder text */
  placeholder?: string
  /** Format hint for specialized string types */
  format?: StringFormat
}

/**
 * String schema field node
 */
export class SchemaStringNode extends BaseSchemaNode<'string', string, StringSchemaOptions> {
  get type(): 'string' {
    return 'string'
  }

  /**
   * Mark this string field as optional
   */
  optional(): SchemaStringNode {
    return new SchemaStringNode({
      ...this._options,
      isOptional: true,
    })
  }
}

/**
 * Create a new string schema field
 *
 * @example
 * ```typescript
 * import { string } from '@auxx/sdk/schema'
 *
 * const messageField = string({
 *   label: 'Message',
 *   description: 'The message to send',
 *   placeholder: 'Enter message...',
 *   minLength: 1,
 *   maxLength: 500
 * })
 * ```
 */
export function string(options?: StringSchemaOptions): SchemaStringNode {
  return new SchemaStringNode(options)
}

/**
 * Create a date string field (YYYY-MM-DD format)
 *
 * @example
 * ```typescript
 * import { date } from '@auxx/sdk/schema'
 *
 * const dueDateField = date({
 *   label: 'Due Date',
 *   description: 'When the task is due',
 *   required: true
 * })
 * ```
 */
export function date(options?: Omit<StringSchemaOptions, 'format'>): SchemaStringNode {
  return new SchemaStringNode({
    ...options,
    format: 'date',
  })
}

/**
 * Create a datetime string field (ISO 8601 format)
 *
 * @example
 * ```typescript
 * import { datetime } from '@auxx/sdk/schema'
 *
 * const createdAtField = datetime({
 *   label: 'Created At',
 *   description: 'When the record was created'
 * })
 * ```
 */
export function datetime(options?: Omit<StringSchemaOptions, 'format'>): SchemaStringNode {
  return new SchemaStringNode({
    ...options,
    format: 'datetime',
  })
}

/**
 * Create a time string field (HH:mm:ss format)
 *
 * @example
 * ```typescript
 * import { time } from '@auxx/sdk/schema'
 *
 * const startTimeField = time({
 *   label: 'Start Time',
 *   description: 'When to start the task'
 * })
 * ```
 */
export function time(options?: Omit<StringSchemaOptions, 'format'>): SchemaStringNode {
  return new SchemaStringNode({
    ...options,
    format: 'time',
  })
}

/**
 * Create an email string field
 *
 * @example
 * ```typescript
 * import { email } from '@auxx/sdk/schema'
 *
 * const recipientField = email({
 *   label: 'Recipient Email',
 *   required: true
 * })
 * ```
 */
export function email(options?: Omit<StringSchemaOptions, 'format'>): SchemaStringNode {
  return new SchemaStringNode({
    ...options,
    format: 'email',
  })
}

/**
 * Create a URL string field
 *
 * @example
 * ```typescript
 * import { url } from '@auxx/sdk/schema'
 *
 * const websiteField = url({
 *   label: 'Website URL',
 *   placeholder: 'https://example.com'
 * })
 * ```
 */
export function url(options?: Omit<StringSchemaOptions, 'format'>): SchemaStringNode {
  return new SchemaStringNode({
    ...options,
    format: 'url',
  })
}
