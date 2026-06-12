// packages/lib/src/json-schema/vendor.ts

import type { JsonSchema } from './infer'

/**
 * Vendor-extension keyword the schema editor uses to carry platform FieldType
 * metadata (FieldType, SelectOption labels/colors) inline on JSON Schema leaf
 * nodes. Custom `x-*` keywords are valid JSON Schema and ignored by tolerant
 * validators, but they must never reach an LLM provider — they are editor
 * bookkeeping, not part of the output contract.
 */
export const VENDOR_KEYWORD = 'x-auxx'

/**
 * Recursively strip every `x-auxx` keyword from a schema, returning a deep
 * clone. Used at the provider boundary so editor metadata never bloats the
 * `response_format` schema (OpenAI) or the prompt-injected schema text
 * (Anthropic).
 */
export function stripVendorKeywords(schema: unknown): unknown {
  return walk(schema, (node) => {
    if (VENDOR_KEYWORD in node) {
      const { [VENDOR_KEYWORD]: _drop, ...rest } = node
      return rest
    }
    return node
  })
}

/**
 * String `format` values OpenAI accepts in strict structured-output mode.
 * Strict mode rejects any other `format`, so unsupported values (notably
 * `uri`, which our URL FieldType emits) must be dropped before the schema is
 * sent. Source: OpenAI structured-outputs supported-keyword list.
 */
const OPENAI_STRICT_FORMATS = new Set<string>([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
])

/**
 * Recursively drop `format` keywords OpenAI strict mode does not support,
 * returning a deep clone. Leaves supported formats untouched. Pair with
 * {@link stripVendorKeywords} on the OpenAI path.
 */
export function sanitizeFormatsForOpenAiStrict(schema: unknown): unknown {
  return walk(schema, (node) => {
    if (
      typeof node.format === 'string' &&
      !OPENAI_STRICT_FORMATS.has(node.format) &&
      isStringType(node.type)
    ) {
      const { format: _drop, ...rest } = node
      return rest
    }
    return node
  })
}

function isStringType(type: unknown): boolean {
  if (type === 'string') return true
  return Array.isArray(type) && type.includes('string')
}

/**
 * Deep-clone a JSON-Schema-shaped value, applying `transform` to every object
 * node (post-order — children are already transformed when the parent runs).
 */
function walk(value: unknown, transform: (node: JsonSchema) => JsonSchema): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, transform))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(val, transform)
    }
    return transform(out)
  }
  return value
}
