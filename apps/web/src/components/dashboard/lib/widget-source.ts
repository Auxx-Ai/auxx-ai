// apps/web/src/components/dashboard/lib/widget-source.ts
//
// Client-safe helpers mapping between a picked resource id and a `WidgetSource`.
// The aggregate engine's real allowlist (`SYSTEM_AGGREGATE_TABLE_IDS`) lives in
// server-only code (drizzle imports), so we keep a client-safe copy here — the
// source picker uses it to decide which system tables are pickable and to tag a
// pick as `{kind:'system'}` vs `{kind:'entity'}`. Kept in sync with
// `packages/lib/src/resources/aggregate/system-aggregate-builder.ts`.

import type { SystemTableId, WidgetSource } from '@auxx/lib/dashboards/client'

/** System tables the aggregate engine can query (client-safe mirror). */
export const SYSTEM_AGGREGATE_SOURCE_IDS = ['thread', 'message', 'article'] as const

export function isSystemAggregateSourceId(id: string): boolean {
  return (SYSTEM_AGGREGATE_SOURCE_IDS as readonly string[]).includes(id)
}

/**
 * Mail-content tables (client-safe mirror of `MAIL_LENS_TABLE_IDS` in
 * `packages/lib/src/resources/picker/mail-lens-tables.ts`).
 *
 * A widget that lists ROWS from these is refused server-side: the metadata /
 * subject / body gradation lives only in `mail-query/`, and the generic record
 * path (`record.listFiltered`) applies none of it. Aggregate widgets still take
 * `thread` / `message` — a grouped count is a different disclosure than a row
 * list — so this is not subtracted from {@link SYSTEM_AGGREGATE_SOURCE_IDS};
 * only the record-list source picker excludes it.
 */
export const MAIL_LENS_SOURCE_IDS = ['thread', 'message'] as const

export function isMailLensSourceId(id: string): boolean {
  return (MAIL_LENS_SOURCE_IDS as readonly string[]).includes(id)
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
 * Build a `WidgetSource` from a picked resource id. System-aggregate tables map
 * to `{kind:'system'}`; everything else (contact/ticket/custom defs) to
 * `{kind:'entity'}`.
 */
export function resourceIdToSource(id: string): WidgetSource {
  if (isSystemAggregateSourceId(id)) return { kind: 'system', tableId: id as SystemTableId }
  return { kind: 'entity', entityDefinitionId: id }
}

export function sourcesEqual(a: WidgetSource | undefined, b: WidgetSource | undefined): boolean {
  if (!a || !b) return a === b
  return sourceResourceId(a) === sourceResourceId(b) && a.kind === b.kind
}
