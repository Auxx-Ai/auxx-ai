// packages/lib/src/resources/registry/output-shape.ts

import { BaseType } from '../types'
import { getFieldOutputKey, type ResourceField } from './field-types'

/**
 * Re-key a raw tier-A (static system table) row by each field's advertised
 * output key ({@link getFieldOutputKey}), MERGED on top of the raw row rather
 * than replacing it.
 *
 * Interim fix for §3.2 / §10b step 4
 * (`plans/kopilot/workflow/10-variable-resolution-deep-dive.md`): `find.ts`
 * stores tier-A results as raw Drizzle rows, keyed by camelCase DB columns
 * (`status`, `assigneeId`, `messageCount`, …). The builder's variable picker
 * advertises tier-A fields by `getFieldOutputKey` (`thread_status`,
 * `assignee_id`, `message_count`, …), which almost never equals the column
 * name — so nearly every advertised field path resolved to `undefined`.
 * Tier-A resolution is exact-match plain-object navigation with no key
 * tolerance, by design (§2 of the doc above); the fix is the STORED SHAPE,
 * not the resolver.
 *
 * Merged, not replaced: `{ ...row, ...aliases }`. Existing hand-typed
 * `{{find_1.thread.status}}` refs (raw camelCase columns) keep resolving —
 * production workflows may already use them — while the declared
 * `{{find_1.thread.thread_status}}` path starts resolving too. A field whose
 * output key already equals its column name is skipped, so it never clobbers
 * the raw value with an identical alias.
 *
 * RELATION fields are skipped: tier A never stores a `ResourceReference`, so
 * there is no lazy-load lane to expand a relation through — aliasing a
 * relation's output key to its (non-scalar) raw column would resolve to the
 * wrong shape, not the missing one. Those paths stay pinned broken in
 * `known-broken.ts`; the real fix is §10b proposal #1 (ResourceReference
 * unification for tier A).
 *
 * Pure: fields in, object out. No DB/cache access.
 */
export function toOutputShape(
  row: Record<string, unknown>,
  fields: ResourceField[]
): Record<string, unknown> {
  const aliases: Record<string, unknown> = {}

  for (const field of fields) {
    if (field.type === BaseType.RELATION) continue
    if (!field.dbColumn) continue
    if (!(field.dbColumn in row)) continue

    const outputKey = getFieldOutputKey(field)
    if (outputKey === field.dbColumn) continue

    aliases[outputKey] = row[field.dbColumn]
  }

  return { ...row, ...aliases }
}
