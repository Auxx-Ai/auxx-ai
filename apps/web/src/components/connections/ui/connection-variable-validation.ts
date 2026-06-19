// apps/web/src/components/connections/ui/connection-variable-validation.ts

import type { ConnectionVariable } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'

/**
 * Conditional visibility (`displayOptions.show`): a field shows only when every referenced key
 * currently holds one of its allowed values. Values compare as strings since the form stores
 * everything as strings (booleans as `'true'`/`'false'`).
 */
export function isFieldVisible(v: ConnectionVariable, values: Record<string, string>): boolean {
  const show = v.displayOptions?.show
  if (!show) return true
  for (const [key, allowed] of Object.entries(show)) {
    if (!allowed.map(String).includes(values[key] ?? '')) return false
  }
  return true
}

/**
 * Validate a single value — required + `minLength`/`maxLength`/`min`/`max`/`port`.
 * Returns an error message, or null when valid.
 */
export function validateValue(v: ConnectionVariable, value: string): string | null {
  // A boolean is always "set" — `false` is a valid value, never a missing one — so it
  // skips the required-empty check (and has no length/range rules to validate).
  if (v.type === FieldType.CHECKBOX) return null
  if (v.required !== false && !value.trim()) {
    return `Please provide a value for "${v.label}".`
  }
  if (!value) return null

  const rules = v.validation
  if (!rules) return null

  if (rules.minLength !== undefined && value.length < rules.minLength) {
    return `${v.label} must be at least ${rules.minLength} characters`
  }
  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    return `${v.label} must be no more than ${rules.maxLength} characters`
  }
  const num = Number(value)
  if (rules.min !== undefined && num < rules.min) {
    return `${v.label} must be at least ${rules.min}`
  }
  if (rules.max !== undefined && num > rules.max) {
    return `${v.label} must be no more than ${rules.max}`
  }
  if (rules.port && (!Number.isInteger(num) || num < 1 || num > 65535)) {
    return `${v.label} must be a valid port number (1-65535)`
  }
  return null
}

/**
 * Validate a whole connection form. Only currently-visible fields are checked (a hidden
 * conditional block neither blocks the submit nor leaks stale values); a bare-secret method
 * also requires the token (error key `__token`). Returns a field→message map (empty = valid).
 */
export function validateConnectionVariables(args: {
  variables: ConnectionVariable[]
  values: Record<string, string>
  requireToken?: boolean
  token?: string
}): Record<string, string> {
  const { variables, values, requireToken = false, token = '' } = args
  const errors: Record<string, string> = {}
  for (const v of variables) {
    if (!isFieldVisible(v, values)) continue
    const error = validateValue(v, values[v.key] ?? '')
    if (error) errors[v.key] = error
  }
  if (requireToken && !token.trim()) errors.__token = 'A value is required'
  return errors
}

/** Seed a field for the form: prefill → declared default → '' (checkbox → 'false'). */
export function seedValue(v: ConnectionVariable, prefill?: Record<string, string>): string {
  const pre = prefill?.[v.key]
  if (pre !== undefined) return pre
  if (v.default !== undefined) return String(v.default)
  // Booleans always need a concrete value so the Switch renders and `required` passes.
  return v.type === FieldType.CHECKBOX ? 'false' : ''
}
