// packages/lib/src/workflow-engine/nodes/utils/moded-field.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import { isBareVariablePath, isVariableTemplate } from './variable-refs'

/**
 * Resolution for config fields the panel can toggle between constant and variable mode.
 *
 * The panel stores a literal of the field's own type in constant mode, and a
 * variable *reference* in variable mode — but which reference shape depends on the
 * editor: `VarEditor` in rich-text mode writes a `{{…}}` template, `VAR_MODE.PICKER`
 * writes a **bare dotted path** (`node-1.result`). A resolver that understands only
 * the first leaves every picker-bound field falling through to its default, with the
 * panel still showing a correctly-filled value — silent, and invisible to the parity
 * suite because both sides agree on what is stored.
 *
 * These are free functions rather than `BaseNodeProcessor` methods so the processors
 * that already grew their own copies can drop them without a `private`-vs-inherited
 * name clash; `BaseNodeProcessor.resolveNumberField` delegates here.
 */

const TRUTHY_STRINGS = new Set(['true', '1', 'yes', 'on'])
const FALSY_STRINGS = new Set(['false', '0', 'no', 'off'])

/**
 * Resolve a bindable config value to whatever it actually refers to.
 *
 * Constant mode (the default when the flag is absent) passes the value straight
 * through untouched. Variable mode resolves both shapes.
 *
 * @returns the resolved value of any type, or the input unchanged when it is a literal
 */
export async function resolveModedValue(
  value: unknown,
  isConstant: boolean | undefined,
  contextManager: ExecutionContextManager
): Promise<unknown> {
  if ((isConstant ?? true) || typeof value !== 'string' || !value) return value
  if (isVariableTemplate(value)) return contextManager.interpolateVariables(value)
  return contextManager.getVariable(value)
}

/**
 * Resolve a numeric config field, falling back when it yields no usable number.
 *
 * Both variable shapes resolve **whatever the mode flag says**, because neither can
 * be a number: a numeric literal never contains `{{`, and `isBareVariablePath`
 * refuses a leading digit so `"0.5"` and `"3.14"` stay numbers. That matters
 * because the flag is absent on hand-authored and template-installed graphs, where
 * honouring it strictly would strand a genuine reference.
 *
 * Non-finite results (an unresolvable path, `"Infinity"`, a boolean) fall back — a
 * numeric config field arriving at an operation as `Infinity` is a crash waiting to
 * happen (`'x'.repeat(Infinity)` throws), never an intended value.
 */
export async function resolveModedNumber(
  value: number | string | undefined | null,
  isConstant: boolean | undefined,
  fallback: number,
  contextManager: ExecutionContextManager
): Promise<number> {
  if (value == null) return fallback
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback

  const trimmed = value.trim()
  if (!trimmed) return fallback

  let resolved: unknown = trimmed
  if (isVariableTemplate(trimmed)) {
    resolved = await contextManager.interpolateVariables(trimmed)
  } else if (isBareVariablePath(trimmed)) {
    resolved = await contextManager.getVariable(trimmed)
  } else if (isConstant === false) {
    // Variable mode over a single-segment id (a loop's `item`, say) — neither shape
    // matches, so ask the context and keep the literal if it has nothing to say.
    resolved = (await contextManager.getVariable(trimmed)) ?? trimmed
  }

  if (resolved == null || typeof resolved === 'boolean') return fallback

  const parsed = typeof resolved === 'number' ? resolved : Number(String(resolved).trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Resolve a string/enum config field.
 *
 * Unlike {@link resolveModedNumber} this trusts the mode flag: a bare dotted path is
 * indistinguishable from a legitimate string literal (`"shipped.today"` is a fine
 * thing to compare against), so only an explicit variable mode makes it a reference.
 */
export async function resolveModedString(
  value: unknown,
  isConstant: boolean | undefined,
  fallback: string,
  contextManager: ExecutionContextManager
): Promise<string> {
  const resolved = await resolveModedValue(value, isConstant, contextManager)
  if (resolved == null || resolved === '') return fallback
  return String(resolved)
}

/**
 * Resolve a boolean toggle.
 *
 * A resolved variable arrives as a real boolean when it came from `setNodeVariable`,
 * but as the string `"true"` / `"false"` whenever it passed through interpolation —
 * both must land on the same answer, and neither may go through plain truthiness
 * (`Boolean('false')` is `true`). Anything unrecognised, including a path that never
 * resolved, falls back rather than silently flipping to `true`.
 */
export async function resolveModedBoolean(
  value: unknown,
  isConstant: boolean | undefined,
  fallback: boolean,
  contextManager: ExecutionContextManager
): Promise<boolean> {
  const resolved = await resolveModedValue(value, isConstant, contextManager)
  if (resolved == null || resolved === '') return fallback
  if (typeof resolved === 'boolean') return resolved
  if (typeof resolved === 'number') return !Number.isNaN(resolved) && resolved !== 0
  if (typeof resolved === 'string') {
    const normalized = resolved.trim().toLowerCase()
    if (TRUTHY_STRINGS.has(normalized)) return true
    if (FALSY_STRINGS.has(normalized)) return false
    return fallback
  }
  return fallback
}
