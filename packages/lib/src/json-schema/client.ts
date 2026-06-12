// packages/lib/src/json-schema/client.ts

/**
 * Client-safe entry point for the JSON Schema helpers. These are all pure,
 * dependency-free functions, so the web app can import them directly without
 * pulling in server-only modules.
 *
 * @see ../../package.json `exports` → `@auxx/lib/json-schema/client`
 */

export { inferJsonSchema, type JsonSchema } from './infer'
export { sanitizeFormatsForOpenAiStrict, stripVendorKeywords, VENDOR_KEYWORD } from './vendor'
