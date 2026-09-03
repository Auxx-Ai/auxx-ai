// packages/lib/src/records/name-case/hook.ts
//
// Pre-write hook that repairs the casing of `contact.first_name` / `contact.last_name`.
//
// Registered per-(entitySlug, systemAttribute) in `field-hooks/register-hooks.ts`.
// One registration covers every writer, because every door funnels through
// `setValueWithBuiltIn` (directly, or via `setValuesForEntity`'s collector) and
// `fireFieldPreHooks` sits on that path: the connector sink, mail/SMS ingest, the CSV
// importer, panel edits, the SDK, Kopilot. Verified rather than assumed —
// `UnifiedCrudHandler` never sets `skipPreHooks`, and the connector's owned-mode
// `OWNED_BYPASS` is an EMPTY set despite a comment that used to claim otherwise.
//
// A `full_name` write lands here too: NAME is a composite with no value of its own and
// is decomposed into two direct `setValueWithBuiltIn` calls against the part fields.
// `EntityInstance.displayName` is denormalized downstream of those, so it picks up the
// repaired value with no extra work.
//
// The decision of WHAT to rewrite lives entirely in `toDisplayCase` (@auxx/utils) —
// only all-upper or all-lower input is ever touched. See
// plans/records/contact-name-casing-plan.md.

import { toDisplayCase } from '@auxx/utils/name-case'
import type { FieldPreHookHandler } from '../../field-hooks/types'

/**
 * Repair the casing of a name value on its way to storage.
 *
 * 🛑 **`event.newValue` is a COERCED ENVELOPE, not a bare string.** Pre-hooks run
 * after `validateAndConvertValue`, so a TEXT field arrives as
 * `{ type: 'text', value: 'BRUCE' }`. Three previous guards in this codebase compared
 * this field directly to a string literal; every one was inert in production, read
 * correctly in review, and passed a unit test that fed it a bare string. See the doc
 * comment on `FieldPreHookEvent.newValue`.
 *
 * Passes through untouched, in this order:
 * - `null` (a clear) and anything that is not a single `text` envelope. A multi-value
 *   array is not a shape either name field uses; if one ever arrives, doing nothing is
 *   the correct answer rather than guessing which element is the name.
 * - Any value `toDisplayCase` declines — mixed case, uncased script, an email address.
 *
 * Returns the ORIGINAL envelope object when nothing changed, so the caller's
 * change-detection sees no write.
 */
export const repairNameCasing: FieldPreHookHandler = async (event) => {
  const value = event.newValue
  if (!value || Array.isArray(value) || value.type !== 'text') return value

  const current = value.value
  if (typeof current !== 'string') return value

  const repaired = toDisplayCase(current)
  if (repaired === current) return value

  return { type: 'text', value: repaired as string }
}
