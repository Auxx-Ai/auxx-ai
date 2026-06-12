// packages/lib/src/json-schema/index.ts

/**
 * JSON Schema helpers shared across the platform: single-sample inference and
 * vendor-keyword / strict-mode sanitization at the LLM provider boundary.
 */

export { inferJsonSchema, type JsonSchema } from './infer'
export { sanitizeFormatsForOpenAiStrict, stripVendorKeywords, VENDOR_KEYWORD } from './vendor'
