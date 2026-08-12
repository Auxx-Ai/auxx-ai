// packages/lib/src/workflow-engine/nodes/dataset/config-value.ts

import { z } from 'zod'

/**
 * Resolves a raw config string against the execution context.
 *
 * Processors pass `(raw) => this.resolveVariableValue(raw, contextManager)`,
 * which handles both `{{a.b}}` templates and the bare dotted paths the
 * variable picker writes, and returns the input unchanged when it is a literal.
 */
export type ConfigValueResolver = (raw: string) => Promise<unknown>

/**
 * Widen a config field's schema so a variable-bound value survives validation.
 *
 * The panels store a literal of the field's own type in constant mode and a
 * variable *reference string* in variable mode — `"chunker_1.chunkCount"` from
 * the picker, or a `"{{…}}"` template from the rich editor. A schema that only
 * accepts the literal type rejects the entire node config the moment any one
 * field is bound, so the node fails before a variable is ever resolved.
 *
 * Resolution and range checking happen in the processor, against the *resolved*
 * value — never against the raw template.
 */
export function variableBound<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.string()])
}

const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g

/**
 * A bare variable path as the picker writes it: an identifier followed by at
 * least one dotted segment, optionally with array accessors. Deliberately
 * refuses anything starting with a digit so numeric literals like `"0.5"` are
 * not mistaken for variable references.
 */
const BARE_PATH_PATTERN = /^[A-Za-z_$][\w$-]*(?:\.[\w$-]+(?:\[(?:-?\d+|\*)\])?)+$/

/**
 * Collect the variable references a bindable config value carries.
 *
 * Covers both shapes a bound field can take: `{{…}}` templates (possibly
 * several in one string) and a single bare picker path.
 */
export function extractVariableRefs(value: unknown): string[] {
  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []

  const refs = new Set<string>()
  for (const match of trimmed.matchAll(TEMPLATE_PATTERN)) {
    const id = match[1]?.trim()
    if (id) refs.add(id)
  }

  if (refs.size === 0 && BARE_PATH_PATTERN.test(trimmed)) {
    refs.add(trimmed)
  }

  return Array.from(refs)
}

const TRUTHY_STRINGS = new Set(['true', '1', 'yes', 'on'])
const FALSY_STRINGS = new Set(['false', '0', 'no', 'off', ''])

/**
 * Coerce an already-resolved value to a boolean.
 *
 * A resolved variable arrives as a real boolean when it came from
 * `setNodeVariable`, but as the string `"true"` / `"false"` whenever it passed
 * through string interpolation. Both must land on the same answer, and neither
 * may go through plain truthiness — `Boolean('false')` is `true`.
 *
 * Anything unrecognised (most often a bare path that never resolved) falls back
 * to the field's declared default rather than silently flipping to `true`.
 */
export function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return !Number.isNaN(value) && value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (TRUTHY_STRINGS.has(normalized)) return true
    if (FALSY_STRINGS.has(normalized)) return false
    return fallback
  }
  return fallback
}

/**
 * Resolve a boolean config field that may be a literal or bound to a variable.
 *
 * A genuine `false` stays `false`; a variable resolving to `true` (or to the
 * string `"true"`) becomes `true`.
 */
export async function resolveBooleanConfig(
  value: boolean | string | undefined,
  fallback: boolean,
  resolve: ConfigValueResolver
): Promise<boolean> {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  return coerceBoolean(await resolve(value), fallback)
}

/**
 * Resolve a numeric config field that may be a literal or bound to a variable.
 *
 * Returns `undefined` when the field is unset or the resolved value is not a
 * finite number, leaving the range check and the error message to the caller.
 */
export async function resolveNumberConfig(
  value: number | string | undefined,
  resolve: ConfigValueResolver
): Promise<number | undefined> {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const resolved = await resolve(trimmed)
  if (resolved === undefined || resolved === null) return undefined
  if (typeof resolved === 'boolean') return undefined

  const parsed = typeof resolved === 'number' ? resolved : Number(String(resolved).trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Resolve a config field constrained to a fixed set of values.
 *
 * Falls back to the default when the field is unset or the resolved value is
 * outside the allowed set — a bound variable is only trusted once it produces
 * something the node can actually act on.
 */
export async function resolveEnumConfig<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  resolve: ConfigValueResolver
): Promise<T> {
  if (!value) return fallback

  if ((allowed as readonly string[]).includes(value)) return value as T

  const resolved = await resolve(value)
  if (typeof resolved !== 'string') return fallback

  const normalized = resolved.trim()
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback
}
