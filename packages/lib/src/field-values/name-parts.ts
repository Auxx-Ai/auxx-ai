// packages/lib/src/field-values/name-parts.ts

import type { NameValue } from './converters/json'
import { nameConverter } from './converters/json'

/**
 * The two TEXT part fields a NAME composite is linked to.
 *
 * A NAME field never stores a value of its own: it is a composite over
 * `options.name.firstNameFieldId` / `.lastNameFieldId`, and every write to it
 * is decomposed into writes against those two part fields. See
 * `plans/field-values/name-field-writes.md`.
 */
export type NameParts = {
  firstNameFieldId: string
  lastNameFieldId: string
}

/**
 * Read the part-field ids off a NAME field's options.
 *
 * Returns `null` when the field is not a NAME field, or when its options do
 * not carry BOTH part ids — an unlinked NAME field has no parts to decompose
 * into, so callers must fall back to their pre-decomposition behavior rather
 * than throw.
 */
export function readNameParts(field: {
  type?: string | null
  options?: unknown
}): NameParts | null {
  if (field.type !== 'NAME') return null

  const nameOpts = (field.options as Record<string, unknown> | null | undefined)?.name as
    | { firstNameFieldId?: unknown; lastNameFieldId?: unknown }
    | undefined

  const first = nameOpts?.firstNameFieldId
  const last = nameOpts?.lastNameFieldId
  if (typeof first !== 'string' || !first) return null
  if (typeof last !== 'string' || !last) return null
  if (first === last) return null

  return { firstNameFieldId: first, lastNameFieldId: last }
}

/**
 * Coerce any accepted NAME input into its two part strings.
 *
 * Delegates to `nameConverter.toTypedInput` so every shape the NAME field has
 * ever accepted keeps working after decomposition — an object
 * (`{ firstName, lastName }`), an already-typed `json` value, and a bare full
 * name string (split on the first whitespace run). Blank/empty input and
 * `null` coerce to `null`, which callers treat as "clear both parts".
 */
export function coerceNameInput(value: unknown): { firstName: string; lastName: string } | null {
  const typed = nameConverter.toTypedInput(value)
  if (!typed) return null

  const raw = (typed as { value?: unknown }).value as NameValue | undefined
  return {
    firstName: raw?.firstName ?? '',
    lastName: raw?.lastName ?? '',
  }
}
