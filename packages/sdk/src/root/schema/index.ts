// packages/sdk/src/root/schema/index.ts

/**
 * Shared schema system for settings and workflows
 * Provides a unified set of field types that can be used by both systems
 */

export { type ArraySchemaOptions, array, SchemaArrayNode } from './array-node.js'
// Base node and types
export { BaseSchemaNode, type BaseSchemaOptions } from './base-node.js'
export { type BooleanSchemaOptions, boolean, SchemaBooleanNode } from './boolean-node.js'
export { type NumberSchemaOptions, number, SchemaNumberNode } from './number-node.js'
// Complex field types
export {
  SchemaSelectNode,
  type SelectOption,
  type SelectSchemaOptions,
  select,
} from './select-node.js'
// Primitive field types
// Specialized string format helpers
export {
  date,
  datetime,
  email,
  phone,
  SchemaStringNode,
  type StringFormat,
  type StringSchemaOptions,
  string,
  time,
  url,
} from './string-node.js'
export { SchemaStructNode, type StructSchemaOptions, struct } from './struct-node.js'

import type { SchemaArrayNode } from './array-node.js'
import type { SchemaBooleanNode } from './boolean-node.js'
import type { SchemaNumberNode } from './number-node.js'
import type { SchemaSelectNode } from './select-node.js'
// Import types for union
import type { SchemaStringNode } from './string-node.js'
import type { SchemaStructNode } from './struct-node.js'

/**
 * Union type of all schema node types
 */
export type SchemaNode =
  | SchemaStringNode
  | SchemaNumberNode
  | SchemaBooleanNode
  | SchemaSelectNode
  | SchemaStructNode
  | SchemaArrayNode
