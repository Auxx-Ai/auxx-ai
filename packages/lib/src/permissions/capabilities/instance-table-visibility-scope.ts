// packages/lib/src/permissions/capabilities/instance-table-visibility-scope.ts

import { type SQL, sql } from 'drizzle-orm'
import type { CapabilityView } from './capability-view'
import type { InstanceListScope, OrgSharedInstanceAccessKey } from './entity-access'
import type { RecordVisibilityScope } from './record-visibility-scope'
import { fnv1a32 } from './scope-fingerprint'

/**
 * **The per-row read policy for the two system tables that ARE instance-access
 * grant targets** — `kb` (`KnowledgeBase`) and `dataset` (`Dataset`).
 *
 * ## Why this had to exist before the record path could serve them
 *
 * `recordScope` answers `{ arm: 'all' }` for every `TableId`, and both the
 * picker and `UnifiedCrudHandler` documented that as "the record lane has no
 * per-row policy for this table". For these two it was never true — their policy
 * is real, it just lives in the composed capability blob rather than in
 * `ResourceAccess` rows a query can correlate against. The by-ids path handled
 * that by filtering AFTER the fetch (`RecordPickerService.admitSystemRows`); the
 * paginated list path had no equivalent, so `record.search` refused these keys
 * outright rather than read org-wide.
 *
 * A post-fetch filter is not an option on the list path: it shorts pages, makes
 * `nextCursor` describe rows the caller never saw, and leaves `total` counting
 * the invisible ones. So the filter has to be a predicate, applied before
 * `LIMIT` — which is exactly what {@link import('./entity-access').instanceListScope}
 * is for.
 *
 * ## Why not the `viewableKnowledgeBaseIds` shape used for `article`
 *
 * Articles inherit their policy ONE HOP AWAY, across a one-to-many placement
 * relation, and a deny-list does not compose across that hop (see
 * `article-visibility-scope.ts`). These tables ARE the grant target: the id in
 * the predicate is the id the grant names, so both arms are directly expressible
 * and no org-cache read is needed to enumerate candidates. That also means no
 * positive-form staleness hazard — an instance missing from a cache cannot hide
 * itself here, because nothing is enumerated from a cache.
 *
 * ## The `source`-KB question, answered elsewhere on purpose
 *
 * `kind: 'source'` knowledge bases must never reach a picker, and a seeded
 * member composes `edit` on them (see `HIDDEN_KB_KINDS`), so `canViewInstance`
 * alone would admit them. They are excluded on this lane by the registry's
 * `neverPickable: { kind: ['source'] }`, applied inside `fetchResourcesDirect`
 * before any caller filter. Restating the rule here would be a second authority
 * for it; the registry is the first, and it covers the by-ids fetch too.
 */

/** `TableId` → the instance-access key its rows are granted under. */
const INSTANCE_BACKED_TABLES = {
  kb: 'kb',
  dataset: 'dataset',
} as const satisfies Record<string, OrgSharedInstanceAccessKey>

export type InstanceBackedTableId = keyof typeof INSTANCE_BACKED_TABLES

/**
 * 🔴 RAW qualified identifiers, for the reason `article-visibility-scope.ts`
 * spells out at length: Drizzle's `buildSelection` rewrites any `Column` chunk —
 * and any bare identifier inside a nested `sql` fragment — to an unqualified
 * name when the query has a single table in its `FROM`. A bare `"id"` would then
 * bind to whichever table the surrounding query is scanning. A raw qualified
 * identifier cannot be rewritten.
 *
 * Keyed by table id rather than derived from `dbName` so the mapping is greppable
 * from the SQL side: these strings must match the physical table the picker's
 * `FROM` names, and a rename that misses this map fails loudly at query time
 * rather than silently matching nothing.
 */
const ID_COLUMNS: Record<InstanceBackedTableId, SQL> = {
  kb: sql.raw('"KnowledgeBase"."id"'),
  dataset: sql.raw('"Dataset"."id"'),
}

/** Whether this system table's rows are governed per instance by the blob. */
export function isInstanceBackedTable(tableId: string): tableId is InstanceBackedTableId {
  return tableId in INSTANCE_BACKED_TABLES
}

/**
 * The record-lane visibility scope for one instance-backed system table.
 *
 * `capabilities: undefined` ⇒ internal caller ⇒ `{ arm: 'all' }`, the same
 * convention `recordScopeArmFor`, `admitSystemRows` and
 * `viewableKnowledgeBaseIds` all follow. It is load-bearing for headless work
 * (embedding jobs, seeders, `apps/kb` rendering, the widget API), so it stays
 * ABOVE the scope resolution rather than inside it.
 *
 * Arms map 1:1 onto {@link InstanceListScope}, so this function adds no policy
 * of its own — it only renders one:
 * - `none` → the caller must return an empty page **without querying**.
 * - `include` → `id = ANY(...)`.
 * - `exclude` → `NOT (id = ANY(...))`, and an EMPTY exclude list is `arm: 'all'`
 *   rather than a tautological predicate, so the overwhelmingly common
 *   unrestricted case costs nothing and keeps its existing cache entries.
 */
export function instanceTableVisibilityScope(
  tableId: InstanceBackedTableId,
  capabilities: CapabilityView | undefined
): RecordVisibilityScope {
  if (!capabilities) return { arm: 'all' }
  const scope = capabilities.instanceListScope(INSTANCE_BACKED_TABLES[tableId])
  if (scope.kind === 'none') return { arm: 'none' }

  const idColumn = ID_COLUMNS[tableId]
  if (scope.kind === 'include') {
    return {
      arm: 'restricted',
      where: sql`${idColumn} = ANY(${idArray(scope.includeIds)}::text[])`,
    }
  }
  if (scope.excludeIds.length === 0) return { arm: 'all' }
  return {
    arm: 'restricted',
    where: sql`NOT (${idColumn} = ANY(${idArray(scope.excludeIds)}::text[]))`,
  }
}

/**
 * The cache-key discriminator for an instance-backed table — the viewer
 * dimension the picker's org-keyed list cache does not otherwise carry.
 *
 * `undefined` for an internal caller and for a genuinely unrestricted member, so
 * their keys stay byte-identical to the ones they had before this scope existed
 * — the two cases that must not fragment the cache, and the two that also
 * produce no predicate.
 *
 * The arm is part of the key, not just the digest: an `include` of a set and an
 * `exclude` of the same set are opposite visible sets, and letting them collide
 * would serve one to the other.
 */
export function instanceTableScopeFingerprint(
  tableId: InstanceBackedTableId,
  capabilities: CapabilityView | undefined
): string | undefined {
  if (!capabilities) return undefined
  const scope = capabilities.instanceListScope(INSTANCE_BACKED_TABLES[tableId])
  if (scope.kind === 'none') return `${tableId}:none`
  const ids = scope.kind === 'include' ? scope.includeIds : scope.excludeIds
  if (scope.kind === 'exclude' && ids.length === 0) return undefined
  return `${tableId}:${scope.kind}:${fnv1a32([...ids].sort().join(','))}`
}

/**
 * cuid2s are `[a-z0-9]{24}`, so a brace-wrapped join needs no quoting — the same
 * assumption `articleVisibilitySql` and `recordSearchVisibilitySql` already make.
 * An empty list renders `'{}'`, which matches nothing; that is only ever reached
 * through the `exclude` arm (where matching nothing is correct), because an empty
 * `include` is normalized to `kind: 'none'` before it gets here.
 */
function idArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`
}
