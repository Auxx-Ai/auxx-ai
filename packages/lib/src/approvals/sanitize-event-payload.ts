// packages/lib/src/approvals/sanitize-event-payload.ts

/**
 * Trigger event payloads in this codebase are NOT uniformly redacted upstream.
 * Free-text field values (TEXT, RICH_TEXT, EMAIL, PHONE_INTL, URL, NAME,
 * ADDRESS_STRUCT) can hold arbitrary user-typed PII; passing them raw into the
 * model context risks leaking customer content.
 *
 * This sanitizer truncates anything that looks like free text to 150 chars +
 * ellipsis. Low-cardinality types (SINGLE_SELECT, MULTI_SELECT, CHECKBOX,
 * NUMBER, DATE, etc.) pass through unchanged because they don't carry PII risk.
 *
 * The model can fetch the full value via a read tool (e.g. `get_entity`) if it
 * decides the truncated context isn't enough.
 */

const FREE_TEXT_FIELD_TYPES = new Set([
  'TEXT',
  'RICH_TEXT',
  'NAME',
  'EMAIL',
  'PHONE_INTL',
  'URL',
  'ADDRESS_STRUCT',
])

const FREE_TEXT_TRUNCATE = 150

/**
 * Sanitize a trigger event payload for safe inclusion in an LLM prompt.
 * Returns a shallow-cloned payload with free-text values truncated.
 */
export function sanitizeEventPayloadForLLM(
  payload: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return payload

  const fieldType = payload.fieldType
  const isFreeTextField = typeof fieldType === 'string' && FREE_TEXT_FIELD_TYPES.has(fieldType)

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (isFreeTextField && (key === 'oldValue' || key === 'newValue' || key === 'value')) {
      out[key] = truncateValue(value)
      continue
    }
    if (isFreeTextField && (key === 'oldDisplay' || key === 'newDisplay')) {
      out[key] = truncateValue(value)
      continue
    }
    if (key === 'snippet' || key === 'content') {
      // Email snippet / comment content can be free-typed even when the parent
      // event isn't a field-update — same PII risk; same truncation rule.
      out[key] = truncateValue(value)
      continue
    }
    out[key] = value
  }
  return out
}

function truncateValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value.length <= FREE_TEXT_TRUNCATE) return value
  return `${value.slice(0, FREE_TEXT_TRUNCATE)}… [truncated]`
}
