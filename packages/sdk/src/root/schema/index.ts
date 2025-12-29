// packages/sdk/src/root/schema/index.ts

/**
 * Shared schema system for settings and workflows
 * Provides a unified set of field types that can be used by both systems
 */

// Base node and types
export { BaseSchemaNode, type BaseSchemaOptions } from './base-node.js'

// Primitive field types
export { SchemaStringNode, type StringSchemaOptions, type StringFormat, string } from './string-node.js'
export { SchemaNumberNode, type NumberSchemaOptions, number } from './number-node.js'
export { SchemaBooleanNode, type BooleanSchemaOptions, boolean } from './boolean-node.js'

// Specialized string format helpers
export { date, datetime, time, email, url } from './string-node.js'

// Complex field types
export {
  SchemaSelectNode,
  type SelectSchemaOptions,
  type SelectOption,
  select,
} from './select-node.js'
export { SchemaStructNode, type StructSchemaOptions, struct } from './struct-node.js'
export { SchemaArrayNode, type ArraySchemaOptions, array } from './array-node.js'

// Import types for union
import type { SchemaStringNode } from './string-node.js'
import type { SchemaNumberNode } from './number-node.js'
import type { SchemaBooleanNode } from './boolean-node.js'
import type { SchemaSelectNode } from './select-node.js'
import type { SchemaStructNode } from './struct-node.js'
import type { SchemaArrayNode } from './array-node.js'

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
