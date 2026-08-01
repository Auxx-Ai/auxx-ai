// apps/web/src/components/dashboard/lib/widget-filter-fields.ts
//
// Which resource fields the widget filter builder may offer for a given
// `WidgetSource`.
//
// The filter builder used to offer every field `useResourceFields` returned, and
// the query builders silently DROP a condition they cannot turn into SQL (the
// deliberate fail-open that keeps a stored view naming a retired field
// renderable). Combined, an author filtering a `thread` widget on `From` or
// `Body` got an UNFILTERED list back while the config panel showed the filter as
// applied — and `Inbox is X` alongside it worked, because that one has a real
// column, which made the failure look like a data problem rather than a dropped
// filter.
//
// So the offer list mirrors what the builder can actually build. Server side is
// still the authority — this only stops the UI from writing a condition that is
// guaranteed to be discarded.

import type { WidgetSource } from '@auxx/lib/dashboards/client'
import type { ResourceField } from '@auxx/lib/resources/client'

/**
 * Mirror of `isFieldValueBackedRelation` in
 * `packages/lib/src/resources/query-builder/system-condition-builder.ts`: an
 * owning relationship with no column of its own stores its links in `FieldValue`,
 * and the builder routes it to a subquery instead of dropping it (`thread:tags`,
 * `article:tags`).
 *
 * `isInverse === true` is excluded on both sides — the value lives in the other
 * row's column, so there is no `FieldValue` row to find (`thread:messages`).
 */
function isFieldValueBackedRelation(field: ResourceField): boolean {
  return (
    !field.dbColumn &&
    Boolean(field.systemAttribute) &&
    Boolean(field.relationship) &&
    field.relationship?.isInverse !== true
  )
}

/**
 * Can the query builder behind `source` turn a condition on `field` into SQL?
 *
 * - **Entity sources** — `EntityInstance`-backed, so every field is reachable:
 *   a column on the instance row or a `FieldValue` subquery. The only gate is
 *   the field's own `filterable` / `hidden` capability.
 * - **System sources** (`thread`, `message`, `article`) — `SystemConditionBuilder`
 *   compares against a real column, so a field needs `dbColumn`, or it must be
 *   one of the `FieldValue`-backed owning relations. Everything else — thread's
 *   `from` / `to` / `body` / `freeText` / `hasAttachments` (mail-query predicates
 *   that only `mail-query/condition-query-builder.ts` implements) and the
 *   column-less `visit*` scalars — is dropped by the builder, fail-open.
 */
export function isWidgetFilterableField(field: ResourceField, source: WidgetSource): boolean {
  if (!field.capabilities?.filterable || field.capabilities.hidden) return false
  if (source.kind !== 'system') return true
  if (field.dbColumn) return true
  // The builder's `custom_` escape hatch — a materialized custom field on a
  // system table resolves through its own subquery.
  if (String(field.key ?? '').startsWith('custom_')) return true
  return isFieldValueBackedRelation(field)
}
