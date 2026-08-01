// apps/web/src/components/dashboard/lib/widget-source.ts
//
// Client-safe helpers mapping between a picked resource id and a `WidgetSource`.
// The aggregate engine's real allowlist (`SYSTEM_AGGREGATE_TABLE_IDS`) lives in
// server-only code (drizzle imports), so we keep a client-safe copy here — the
// source picker uses it to decide which system tables are pickable and to tag a
// pick as `{kind:'system'}` vs `{kind:'entity'}`. Kept in sync with
// `packages/lib/src/resources/aggregate/system-aggregate-builder.ts`.

import type { SystemTableId, WidgetSource } from '@auxx/lib/dashboards/client'

/**
 * System tables the aggregate engine can query (client-safe mirror).
 *
 * 🔴 **`thread` and `message` were here and are gone**, tracking the same
 * removal from `SYSTEM_AGGREGATE_TABLE_IDS` server-side: the aggregate builder
 * emits `WHERE organizationId = $1` and nothing else, so a chart over `thread`
 * counted the whole org mailbox and a high-cardinality group-by printed subject
 * lines as its labels. `prepareAggregate` now throws `ForbiddenError` for both.
 * Keeping them here offered a source that could only ever 403.
 */
export const SYSTEM_AGGREGATE_SOURCE_IDS = ['article'] as const

export function isSystemAggregateSourceId(id: string): boolean {
  return (SYSTEM_AGGREGATE_SOURCE_IDS as readonly string[]).includes(id)
}

/**
 * Mail-content tables (client-safe mirror of `MAIL_LENS_TABLE_IDS` in
 * `packages/lib/src/resources/picker/mail-lens-tables.ts`).
 *
 * Every generic path to these refuses: rows (`record.listFiltered` →
 * `assertNotMailLensTable`) **and** aggregates (`prepareAggregate` /
 * `buildSystemAggregateSql`). The metadata / subject / body gradation lives only
 * in `mail-query/`, and a row predicate would not substitute for it — it admits
 * a row at `metadata` while reading a subject needs `identity`.
 *
 * Two uses, and they are different questions:
 * - the source picker drops these from the offer list, so no NEW widget can name
 *   one (`excludeMailLensTables`);
 * - the widget bodies test a STORED source against it, so an existing widget
 *   renders "data source unavailable" instead of a permission error.
 */
export const MAIL_LENS_SOURCE_IDS = ['thread', 'message'] as const

export function isMailLensSourceId(id: string): boolean {
  return (MAIL_LENS_SOURCE_IDS as readonly string[]).includes(id)
}

/**
 * Does this widget's stored source point at a mail table? True ⇒ every server
 * path behind the widget refuses, so the body must degrade rather than fetch.
 */
export function isMailLensSource(source: WidgetSource | undefined): boolean {
  return !!source && isMailLensSourceId(sourceResourceId(source))
}

/**
 * A `FORBIDDEN` answer from the widget's data query.
 *
 * The belt to {@link isMailLensSource}'s braces: that test reads a client-side
 * MIRROR of the server's refusal list, and this file's history is that the
 * mirror drifted (it still offered `thread` as an aggregate source for a release
 * after the server stopped accepting it). A refusal the mirror does not predict
 * must still land on the degraded state rather than a red error, so the
 * degradation cannot rot into an error the day a table is added server-side.
 */
export function isForbiddenSourceError(
  error: { data?: { code?: string | null } | null } | null | undefined
): boolean {
  return error?.data?.code === 'FORBIDDEN'
}

/**
 * The resource/entity-definition id a `WidgetSource` points at — the value both
 * `FieldPicker` (`entityDefinitionId`) and `useResourceFields` key on. Same shape
 * for entity + system sources (system table ids like `'thread'` resolve through
 * the resource store).
 */
export function sourceResourceId(source: WidgetSource): string {
  return source.kind === 'system' ? source.tableId : source.entityDefinitionId
}

/**
 * Build a `WidgetSource` from a picked resource id. System tables map to
 * `{kind:'system'}`; everything else (contact/ticket/custom defs) to
 * `{kind:'entity'}`.
 *
 * Mail ids are unreachable here (the picker excludes them) but are still tagged
 * `system` — mis-tagging one as an entity def would send it down the
 * `EntityInstance` path, which is a different wrong answer than a refusal.
 */
export function resourceIdToSource(id: string): WidgetSource {
  if (isSystemAggregateSourceId(id) || isMailLensSourceId(id))
    return { kind: 'system', tableId: id as SystemTableId }
  return { kind: 'entity', entityDefinitionId: id }
}

export function sourcesEqual(a: WidgetSource | undefined, b: WidgetSource | undefined): boolean {
  if (!a || !b) return a === b
  return sourceResourceId(a) === sourceResourceId(b) && a.kind === b.kind
}
