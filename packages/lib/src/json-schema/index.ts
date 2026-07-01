// packages/lib/src/json-schema/index.ts

/**
 * JSON Schema helpers shared across the platform: single-sample inference and
 * vendor-keyword / strict-mode sanitization at the LLM provider boundary.
 */

export {
  type CollectLeavesOptions,
  collectSchemaLeaves,
  lastSegment,
  type SourceLeaf,
  STRUCT_FIELD_TYPE_KEYWORD,
} from './flatten'
export { inferJsonSchema, type JsonSchema } from './infer'
export { sanitizeFormatsForOpenAiStrict, stripVendorKeywords, VENDOR_KEYWORD } from './vendor'
