// packages/lib/src/placeholders/fallback-codec.ts
//
// Typed payload for the `data-fallback` attribute on placeholder spans.
// Shared by the Tiptap node (client) and the server-side resolver so both
// round-trip the same shape. Versioned via `v` — readers discard unknown
// versions as if the attribute were unset.

/**
 * Typed fallback payload stored in the `data-fallback` attribute of a
 * placeholder span. The `t` discriminator matches `FieldType` (from
 * `@auxx/database/types`) for field-backed tokens, and a compatible short
 * code for synthetic `org:*` tokens.
 *
 * Phase 1 supports primitive + NAME types. SINGLE_SELECT / MULTI_SELECT /
 * TAGS / RELATIONSHIP / ACTOR need a label-resolution layer before they
 * can be rendered to customer-facing content — deferred.
 */
export type FallbackPayload =
  | { v: 1; t: 'TEXT' | 'URL' | 'EMAIL' | 'PHONE_INTL'; d: string }
  | { v: 1; t: 'NUMBER' | 'CURRENCY'; d: number }
  | { v: 1; t: 'DATE' | 'DATETIME' | 'TIME'; d: string }
  | { v: 1; t: 'CHECKBOX'; d: boolean }
  | { v: 1; t: 'NAME'; d: { firstName: string; lastName: string } }

/** Field types the popover editor currently supports for fallback input. */
export type FallbackSupportedType = FallbackPayload['t']

const SUPPORTED: ReadonlySet<string> = new Set<FallbackSupportedType>([
  'TEXT',
  'URL',
  'EMAIL',
  'PHONE_INTL',
  'NUMBER',
  'CURRENCY',
  'DATE',
  'DATETIME',
  'TIME',
  'CHECKBOX',
  'NAME',
])

export function isFallbackSupportedType(t: string): t is FallbackSupportedType {
  return SUPPORTED.has(t)
}

export function encodeFallback(payload: FallbackPayload): string {
  return JSON.stringify(payload)
}

/**
 * Parse a `data-fallback` attribute back into a `FallbackPayload`.
 *
 * Returns `null` for: `null` / empty input, malformed JSON, unknown versions,
 * or unknown `t` values. Treating "can't decode" the same as "no fallback"
 * is intentional — the resolver then falls back to its hard-fail path, which
 * is the correct behavior when a document was authored against an older or
 * newer payload format.
 */
export function decodeFallback(raw: string | null | undefined): FallbackPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; t?: unknown }
    if (parsed?.v !== 1) return null
    if (typeof parsed.t !== 'string' || !isFallbackSupportedType(parsed.t)) return null
    return parsed as FallbackPayload
  } catch {
    return null
  }
}

/**
 * Render a decoded payload to the plain text that should replace the
 * placeholder span when the resolved value is null/empty.
 *
 * Synchronous by design — every supported type resolves from the payload
 * without any DB / service lookup. Future types that require lookups
 * (RELATIONSHIP, ACTOR) should be pre-batched in Pass 1 of the resolver
 * rather than making this function async.
 */
export function renderFallbackPayload(payload: FallbackPayload): string {
  switch (payload.t) {
    case 'TEXT':
    case 'URL':
    case 'EMAIL':
    case 'PHONE_INTL':
      return payload.d
    case 'NUMBER':
    case 'CURRENCY':
      return String(payload.d)
    case 'DATE':
    case 'DATETIME':
    case 'TIME':
      return payload.d
    case 'CHECKBOX':
      return payload.d ? 'Yes' : 'No'
    case 'NAME':
      return [payload.d.firstName, payload.d.lastName].filter(Boolean).join(' ')
  }
}
