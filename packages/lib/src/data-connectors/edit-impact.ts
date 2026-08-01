// packages/lib/src/data-connectors/edit-impact.ts
// Mapping-edit safety classifier (Layer 1). Pure functions — no DB, no I/O — that
// take a prior row + the patch and return a `StructuralImpact`: how much an edit
// invalidates already-synced data. The mutation layer acts on the result (stamp
// `resyncPending`, and on `rebind` neutralize stale binds). Kept DB-free so it
// unit-tests trivially and dodges the vitest drizzle-column gotchas.
//
// See plans/data-connectors/v4/mapping-edit-safety-plan.md (Layer 1 table).

import type { DataConnectorMappingRow, DataConnectorRow, DataConnectorStreamRow } from './service'
import type { DataConnectorConfig, FieldMapping, StreamRequestConfig } from './types'

/**
 * Blast radius of a structural edit, lowest → highest:
 *  - `cosmetic`   → no data impact; write and move on.
 *  - `rebackfill` → existing rows need (re-)projection (a new/edited formula, a
 *                   retarget, a field that wasn't written before, or a source/
 *                   credential change that invalidates the cursor).
 *  - `rebind`     → the `(mappingId, externalId)` identity key (or its target def)
 *                   changed — old binds are no longer authoritative.
 */
export type StructuralChangeLevel = 'cosmetic' | 'rebackfill' | 'rebind'

export interface StructuralImpact {
  level: StructuralChangeLevel
  /** Short reason codes (e.g. `'rootPath'`, `'field-added'`) for the banner detail. */
  reasons: string[]
}

const LEVEL_RANK: Record<StructuralChangeLevel, number> = {
  cosmetic: 0,
  rebackfill: 1,
  rebind: 2,
}

/** True when a value reads as "writing" (any merge strategy that isn't `ignore`). */
function isWriting(fm: Pick<FieldMapping, 'mergeStrategy'>): boolean {
  return (fm.mergeStrategy ?? 'overwrite') !== 'ignore'
}

/**
 * Stable signature of a field's identity ROLE (absent ⇒ no role). Covers both the
 * secondary `match` key AND the primary `externalId` anchor — changing either
 * re-keys identity, so a diff is a `rebind` (relationship-linking v3 §9.5).
 */
function identitySig(fm: Pick<FieldMapping, 'identityRole'>): string {
  const r = fm.identityRole
  if (!r) return ''
  return r.kind === 'match' ? `match:${r.normalize ?? 'none'}` : `externalId:${r.order ?? 0}`
}

/**
 * Diff two `fieldMappings` arrays (keyed by stable entry `id`) into reason codes.
 * Rules (Layer 1 table):
 *  - `match` flag added / removed / normalize changed  → `rebind` (secondary identity)
 *  - entry added that writes (mergeStrategy ≠ ignore)  → `rebackfill` (field-added)
 *  - `targetFieldRef` retargeted A→B (both non-null)   → `rebackfill` (field-retargeted)
 *  - `expression` / `sourceFields` changed             → `rebackfill` (expression)
 *  - `mergeStrategy` `ignore` → any writing strategy   → `rebackfill` (merge-ignore-to-write)
 *  - any other `mergeStrategy` change / entry removed   → cosmetic (no resync helps)
 */
function diffFieldMappings(prev: FieldMapping[], next: FieldMapping[]): string[] {
  const reasons: string[] = []
  const prevById = new Map(prev.map((fm) => [fm.id, fm]))
  const nextById = new Map(next.map((fm) => [fm.id, fm]))

  for (const fm of next) {
    const before = prevById.get(fm.id)
    if (!before) {
      // New entry. An identity-role add (match key OR external-id anchor) → rebind.
      if (fm.identityRole) reasons.push('identity-match')
      else if (isWriting(fm) && fm.targetFieldRef != null) reasons.push('field-added')
      continue
    }
    // Identity-role change (match flip / normalize / external-id order) → rebind.
    if (identitySig(before) !== identitySig(fm)) reasons.push('identity-match')
    // Retarget A→B (both concrete) needs re-projection of the new column.
    if (
      before.targetFieldRef != null &&
      fm.targetFieldRef != null &&
      before.targetFieldRef !== fm.targetFieldRef
    ) {
      reasons.push('field-retargeted')
    }
    // Formula change → re-projection.
    if (
      before.expression !== fm.expression ||
      JSON.stringify(before.sourceFields) !== JSON.stringify(fm.sourceFields)
    ) {
      reasons.push('expression')
    }
    // `ignore` → writing means "start writing this field" — history is missing it.
    const beforeStrat = before.mergeStrategy ?? 'overwrite'
    if (beforeStrat === 'ignore' && isWriting(fm)) reasons.push('merge-ignore-to-write')
  }

  // An identity-role entry that was REMOVED also re-keys identity → rebind.
  for (const fm of prev) {
    if (fm.identityRole && !nextById.has(fm.id)) reasons.push('identity-match')
  }
  return reasons
}

/** Pick the highest-ranked level present in the reason set. */
function levelFor(reasons: string[]): StructuralChangeLevel {
  if (reasons.includes('identity-match')) return 'rebind'
  if (reasons.length > 0) return 'rebackfill'
  return 'cosmetic'
}

/** The patch shape `updateMapping` accepts (subset of mapping columns). */
export interface MappingPatch {
  rootPath?: string
  linkMode?: string
  parentMappingId?: string | null
  relationshipFieldKey?: string | null
  orphanBehavior?: string
  entityDefinitionId?: string | null
  targetMode?: string
  fieldMappings?: FieldMapping[]
}

/**
 * Classify a mapping edit. `rebind` columns: `rootPath`, `parentMappingId`,
 * `entityDefinitionId`, `targetMode`, `linkMode`, and any per-field `identityRole`
 * change (the external-id anchor or secondary match key — the only identity inputs
 * that exist on the mapping). `relationshipFieldKey`/`orphanBehavior` are cosmetic.
 * Field-mapping content diffs decide rebackfill vs cosmetic.
 */
export function classifyMappingChange(
  prev: DataConnectorMappingRow,
  patch: MappingPatch
): StructuralImpact {
  const reasons: string[] = []

  if (patch.rootPath !== undefined && patch.rootPath !== prev.rootPath) reasons.push('rootPath')
  if (
    patch.parentMappingId !== undefined &&
    (patch.parentMappingId ?? null) !== prev.parentMappingId
  )
    reasons.push('parent-mapping')
  if (
    patch.entityDefinitionId !== undefined &&
    (patch.entityDefinitionId ?? null) !== prev.entityDefinitionId
  )
    reasons.push('target-def')
  if (patch.targetMode !== undefined && patch.targetMode !== prev.targetMode)
    reasons.push('target-mode')
  if (patch.linkMode !== undefined && patch.linkMode !== prev.linkMode) reasons.push('link-mode')

  if (patch.fieldMappings !== undefined) {
    reasons.push(...diffFieldMappings(prev.fieldMappings ?? [], patch.fieldMappings))
  }

  // rootPath / parentMappingId / target-def / target-mode / link-mode all change the
  // identity key or its target def → rebind. Field diffs may add their own rebind
  // (identity-match) reason; otherwise they're rebackfill.
  const isRebind = reasons.some((r) =>
    [
      'rootPath',
      'parent-mapping',
      'target-def',
      'target-mode',
      'link-mode',
      'identity-match',
    ].includes(r)
  )
  const level: StructuralChangeLevel = isRebind
    ? 'rebind'
    : reasons.length > 0
      ? 'rebackfill'
      : 'cosmetic'
  return { level, reasons }
}

/** The patch shape `updateConnector` accepts that can affect data. */
export interface ConnectorPatch {
  config?: DataConnectorConfig
  credentialId?: string | null
}

/**
 * Classify a connector edit. A connector change is never `rebind` (identity lives on
 * the mapping) — at most `rebackfill`: a new credential or any `config` change
 * (endpoint / filters / backfill window) invalidates the cursor against the source.
 * `name`/`syncBehavior`/`scheduleConfig`/`status`/`appInstallationId` are lifecycle,
 * not data — cosmetic.
 */
export function classifyConnectorChange(
  prev: DataConnectorRow,
  patch: ConnectorPatch
): StructuralImpact {
  const reasons: string[] = []
  if (patch.credentialId !== undefined && (patch.credentialId ?? null) !== prev.credentialId)
    reasons.push('credential')
  if (patch.config !== undefined && JSON.stringify(patch.config) !== JSON.stringify(prev.config))
    reasons.push('config')
  return { level: levelFor(reasons), reasons }
}

/** The patch shape `setStreamRequestConfig` accepts. */
export interface StreamRequestPatch {
  requestConfig?: StreamRequestConfig
  syncMode?: string
}

/**
 * Classify a stream request-config edit. A request-config change (path / params /
 * pagination) or a `syncMode` flip invalidates the cursor against the source →
 * `rebackfill`. `enabled` toggles are cosmetic (the next sync includes/excludes the
 * stream naturally). Never `rebind` (no identity here).
 */
export function classifyStreamRequestChange(
  prev: DataConnectorStreamRow,
  patch: StreamRequestPatch
): StructuralImpact {
  const reasons: string[] = []
  if (
    patch.requestConfig !== undefined &&
    JSON.stringify(patch.requestConfig) !== JSON.stringify(prev.requestConfig)
  )
    reasons.push('request-config')
  if (patch.syncMode !== undefined && patch.syncMode !== prev.syncMode) reasons.push('sync-mode')
  return { level: levelFor(reasons), reasons }
}

/**
 * Pick the higher of two impact levels (for merging an escalating pending state).
 * Generic so the result stays within the levels actually passed in — merging two
 * `ResyncPending.level`s (`'rebackfill' | 'rebind'`) can never produce `'cosmetic'`.
 */
export function maxLevel<A extends StructuralChangeLevel, B extends StructuralChangeLevel>(
  a: A,
  b: B
): A | B {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b
}
