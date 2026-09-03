// packages/lib/src/data-connectors/catalog-shape.ts
// The shape an app catalog's connector section materializes into, derived WITHOUT
// writing anything (plans/money/tasks/41-connector-catalog-update.md section 5.1).
// `createConnectorFromAppCatalog` persists exactly what `deriveStreamShape` returns,
// and the catalog-update diff derives the same shape for two catalog versions and
// compares it against the persisted rows, so the seeder and the diff cannot drift.
// The per-row `catalogHash` (D3) is the hash of the normalized shape in this file.
//
// Pure: no DB, no cache. The org-specific lookups the seeder needs (system def ids,
// their fields, an adoptable owned def) arrive pre-loaded through `ShapeResolver`.

import { createHash } from 'node:crypto'
import type {
  CatalogConnectorOwnedMappingField,
  CatalogConnectorStream,
  CatalogDataConnector,
  CatalogEntity,
  CatalogPayload,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  getFieldDefinitionId,
  getFieldId,
  isAppFieldRef,
  isResourceFieldId,
  parseAppFieldRef,
  type ResourceFieldId,
  toAppFieldRef,
  toResourceFieldId,
} from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import {
  appCatalogStreamSchema,
  buildContributingAutoBindings,
  buildContributingConnectionAppFields,
  buildContributingFieldBindings,
  buildContributingMatchBindings,
  type ContributingTargetField,
  isContributingCatalogMapping,
  isOwnedCatalogMapping,
} from './app-catalog'
import type { StreamWithRawMappings } from './service'
import { isBoundaryPrefix, relativeSourcePath } from './source-paths'
import type {
  FieldMapping,
  FieldMergeStrategy,
  IdentityRole,
  LinkMode,
  OrphanBehavior,
  StreamWebhookTrigger,
  SyncMode,
  TargetMode,
} from './types'

const logger = createScopedLogger('data-connector-catalog-shape')

// ── Path + ref helpers the seeder has always used (moved here from mutations.ts) ──

/**
 * The parent of `rootPath` among `all` is the mapping whose rootPath is the longest
 * PROPER boundary-prefix: `''` parents everything, `line_items[]` parents
 * `line_items[].variants[]`. A bare prefix that doesn't end on a path boundary
 * (`line_items` vs `line_items_extra[]`) is rejected. Returns null for a root mapping.
 */
export function ownedParentRootPath(rootPath: string, all: string[]): string | null {
  const parents = all.filter((p) => p !== rootPath && isBoundaryPrefix(rootPath, p))
  if (parents.length === 0) return null
  return parents.reduce((longest, p) => (p.length > longest.length ? p : longest))
}

/**
 * The STORED form of a manifest mapping's payload-absolute `rootPath`: relativized
 * against its parent mapping's rootPath (the longest proper boundary-prefix among
 * `allRootPaths`), unchanged for a root mapping. The seeder stores this form, and every
 * consumer (`absolutePrefix`, `subtreeUnder`, the sync `mapRecord` subtree descent, and
 * the install-time binder's `(streamKey, rootPath)` `===` match) expects it. Any
 * projection of the manifest (`projectConnectorOwnedTargets`) MUST relativize through
 * this same function, or its emitted rootPath silently never matches a stored row.
 */
export function storedRootPath(rootPath: string, allRootPaths: string[]): string {
  const parentRootPath = ownedParentRootPath(rootPath, allRootPaths)
  return parentRootPath != null ? relativeSourcePath(rootPath, parentRootPath) : rootPath
}

/**
 * Field mappings for an UNBOUND owned mapping (v6, Option A). Each declared owned
 * field (`{ key, sourcePath }`, already normalized with type/name/identity copied from
 * the entity's own `FieldDecl` at catalog-extraction time) becomes one entry carrying
 * the connection-late-bound `@app:` ref `${ownedApiSlug}:@app:${appSlug}:${key}`. The
 * key rides in the ref so the install `onComplete` can rewrite it, and the ref also
 * resolves at sync time against the connector's connection. The expression mirrors the
 * manual editor (`{<sourcePath>}` over an identity `sourceFields` map) with
 * `sourcePath` already relative to the mapping's `rootPath` (the SDK contract).
 */
export function buildAppOwnedFieldMappings(
  fields: readonly CatalogConnectorOwnedMappingField[],
  appSlug: string,
  ownedApiSlug: string
): FieldMapping[] {
  // The manifest may flag one field `identity: true` (the owned record's External ID).
  // v1 allows at most one per owned def: first wins, warn on extras, so the stamped
  // `identityRole` is unambiguous.
  let externalIdClaimed = false
  return fields.map((field) => {
    // The flagged field keeps its column write AND gains `identityRole: externalId`, so
    // the visible column and the record's identity agree by construction.
    let isExternalId = field.identity === true
    if (isExternalId && externalIdClaimed) {
      logger.warn('Multiple identity fields on one owned def, ignoring extra', {
        appSlug,
        ownedApiSlug,
        fieldKey: field.key,
      })
      isExternalId = false
    }
    if (isExternalId) externalIdClaimed = true
    return {
      id: generateId(),
      targetFieldRef: toAppFieldRef(ownedApiSlug, appSlug, field.key),
      expression: `{${field.sourcePath}}`,
      sourceFields: { [field.sourcePath]: field.sourcePath },
      ...(isExternalId ? { identityRole: { kind: 'externalId' as const } } : {}),
    }
  })
}

/**
 * Wrap a manifest's BARE `relationshipFieldKey` (e.g. `product`) into the same
 * connection-late-bound `@app:` envelope the owned field refs use:
 * `${parentSlug}:@app:${appSlug}:${key}`. The edge field lives on the PARENT def, so the
 * (cosmetic) leading segment is the parent's slug; the sink and editor resolve def-keyed
 * on `@app:${appSlug}:${key}` and never read the leading segment. `null`/absent passes
 * through.
 */
export function appRelationshipFieldKey(
  bareKey: string | null | undefined,
  appSlug: string,
  parentSlug: string
): string | null {
  return bareKey ? toAppFieldRef(parentSlug, appSlug, bareKey) : null
}

/**
 * The External-ID anchor a `reference` (id-only edge) mapping carries so the FK value
 * resolves to the related record's external id at sync. A bare scalar-rooted reference
 * (e.g. `line_items[].product_id -> product`) declares no `fieldMappings` in the
 * manifest, so the seeder synthesizes the same anchor the interactive `linkRelationship`
 * ships (`{source}` over the reference's own scalar, marked External ID).
 */
export function buildReferenceAnchor(): FieldMapping {
  return {
    id: generateId(),
    targetFieldRef: null,
    expression: '{source}',
    sourceFields: {},
    identityRole: { kind: 'externalId' },
  }
}

/**
 * Prefix a manifest `relationshipFieldKey` may carry to name a PRE-EXISTING SYSTEM
 * relationship field on the parent def by its `systemAttribute`, e.g.
 * `'system:part_catalog_items'`. Nothing is provisioned for it; the key resolves at
 * install to the concrete `defId:fieldId` ref the manual editor stores. A bare key (no
 * prefix) keeps the `@app:` envelope path ({@link appRelationshipFieldKey}).
 */
export const SYSTEM_RELATIONSHIP_PREFIX = 'system:'

/**
 * Resolve a contributing mapping's manifest `relationshipFieldKey` into the stored ref
 * form, given the parent def's fields. Two author-facing forms:
 *   - bare app key (`'product'`) -> the connection-late-bound `@app:` envelope;
 *   - `'system:<systemAttribute>'` -> resolved NOW against the (contributing) parent
 *     def's fields to the concrete `${defId}:${fieldId}` ref. Requires a contributing
 *     parent; an owned/absent parent or an unknown attribute warns and drops the edge
 *     (the mapping still lands, edge-less).
 */
export function resolveRelationshipFieldKeyFromFields(
  bareKey: string | null | undefined,
  appSlug: string,
  parentSlug: string,
  /** The parent def id when the parent is a CONTRIBUTING mapping; null otherwise. */
  parentDefId: string | null,
  parentFields: readonly ContributingTargetField[]
): string | null {
  if (!bareKey) return null
  if (!bareKey.startsWith(SYSTEM_RELATIONSHIP_PREFIX)) {
    return appRelationshipFieldKey(bareKey, appSlug, parentSlug)
  }
  const systemAttribute = bareKey.slice(SYSTEM_RELATIONSHIP_PREFIX.length)
  if (!parentDefId) {
    logger.warn('system relationshipFieldKey needs a contributing parent def, dropping edge', {
      appSlug,
      relationshipFieldKey: bareKey,
    })
    return null
  }
  const field = parentFields.find((f) => f.systemAttribute === systemAttribute)
  if (!field) {
    logger.warn('system relationshipFieldKey does not resolve on parent def, dropping edge', {
      appSlug,
      parentDefId,
      systemAttribute,
    })
    return null
  }
  return toResourceFieldId(parentDefId, field.id)
}

// ── Shape model ───────────────────────────────────────────────────────────────

/** Pre-loaded org lookups the derivation needs; built by `loadShapeResolver` (mutations). */
export interface ShapeResolver {
  /** System entity kind (`contact`, `part`) -> the org's def id; undefined when absent. */
  entityDefIdByKind: (entityKind: string) => string | undefined
  /** A def's fields (the cached `CustomField` rows), used for binding + edge resolution. */
  fieldsByDefId: (entityDefinitionId: string) => ContributingTargetField[]
  /** An adoptable app-owned def for `entityKey` under this install, or null to seed unbound. */
  ownedDefIdByEntityKey: (entityKey: string) => string | null
}

/** One field binding in its comparable form: ids and cosmetic ref segments stripped. */
export interface BindingShape {
  /**
   * Normalized target: `@app:<slug>:<key>` for any app-declared field (late-bound or
   * resolved), the concrete `<defId>:<fieldId>` for a system field, null for the
   * target-less External-ID anchor of a `reference` edge.
   */
  target: string | null
  expression: string
  sourceFields: Record<string, string>
  identityRole: IdentityRole | null
  mergeStrategy: FieldMergeStrategy
  connectionMetaKey: string | null
}

/** A mapping in its comparable form; `key` is how the diff pairs derived and persisted rows. */
export interface MappingShape {
  /** `${targetMode}:${targetKey}@${rootPath}` joined to the parent's key (see `mappingKey`). */
  key: string
  parentKey: string | null
  /** Stored (parent-relative) rootPath. */
  rootPath: string
  targetMode: TargetMode
  /** Contributing: the resolved def id. Owned: the manifest `entityKey`. `?` when unresolvable. */
  targetKey: string
  /** Human label for the target: the entity kind or owned entity key. */
  targetLabel: string
  /** Normalized edge ref (`@app:` form stripped of its cosmetic leading segment). */
  relationshipFieldKey: string | null
  orphanBehavior: OrphanBehavior
  /** Sorted by target for a stable hash. */
  bindings: BindingShape[]
}

/** A derived mapping: the comparable shape plus exactly what `addMapping` is given. */
export interface DerivedMapping extends MappingShape {
  /** Payload-absolute rootPath (what the manifest declares); parents nest on this. */
  absoluteRootPath: string
  linkMode: LinkMode
  entityDefinitionId: string | null
  fieldMappings: FieldMapping[]
  /** `bindingKey` -> the `FieldMapping` entry behind it (first wins on a duplicate target). */
  fieldMappingByBindingKey: Record<string, FieldMapping>
  /** The edge ref exactly as the row stores it (`relationshipFieldKey` is its normalized form). */
  storedRelationshipFieldKey: string | null
  /** Owned only: the manifest apiSlug the late-bound refs are namespaced with. */
  apiSlug: string | null
}

/** A stream in its comparable form. */
export interface StreamShape {
  key: string
  syncMode: SyncMode
  webhookTrigger: StreamWebhookTrigger | null
  sourceSchema: Record<string, unknown> | null
}

/** A derived stream: comparable shape plus its mappings in seeding order (parents first). */
export interface DerivedStream extends StreamShape {
  mappings: DerivedMapping[]
}

/** A persisted mapping row read back into the comparable shape. */
export interface PersistedMapping {
  row: StreamWithRawMappings['mappings'][number]
  shape: MappingShape
  /** `bindingKey` -> the row's `FieldMapping` entry behind it (first wins on a duplicate). */
  fieldMappingByBindingKey: Record<string, FieldMapping>
}

/** A persisted stream row (with its mappings) read back into the comparable shape. */
export interface PersistedStream {
  row: StreamWithRawMappings
  shape: StreamShape
  mappings: PersistedMapping[]
}

/** The mapping key: target identity at a rootPath, under a parent key. */
export function mappingKey(
  parentKey: string | null,
  rootPath: string,
  targetMode: TargetMode,
  targetKey: string
): string {
  const own = `${targetMode}:${targetKey}@${rootPath}`
  return parentKey ? `${parentKey}>${own}` : own
}

// ── Normalization + hashing ───────────────────────────────────────────────────

/** JSON with object keys sorted at every level, so equal shapes hash equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeysDeep(v)
    }
    return out
  }
  return value
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Normalize a target ref for comparison. App-declared fields collapse to
 * `@app:<slug>:<key>` whether the row carries the late-bound ref (seeded) or a concrete
 * id the install later resolved; the cosmetic leading segment (manifest apiSlug vs
 * installed apiSlug vs def id) is dropped. System fields keep their concrete ref.
 */
export function normalizeTargetRef(
  ref: string | null | undefined,
  fieldsByDefId: ShapeResolver['fieldsByDefId']
): string | null {
  if (!ref) return null
  const app = parseAppFieldRef(ref)
  if (app) return `@app:${app.appSlug}:${app.appFieldKey}`
  if (!isResourceFieldId(ref)) return ref
  const defId = getFieldDefinitionId(ref as ResourceFieldId)
  const fieldId = getFieldId(ref as ResourceFieldId)
  const field = fieldsByDefId(defId).find((f) => f.id === fieldId)
  if (field?.appFieldKey && field.appSlug) return `@app:${field.appSlug}:${field.appFieldKey}`
  return ref
}

/** Normalize a stored edge ref the same way (the `@app:` envelope drops its parent slug). */
export function normalizeRelationshipFieldKey(key: string | null | undefined): string | null {
  if (!key) return null
  if (isAppFieldRef(key)) {
    const parts = parseAppFieldRef(key)
    if (parts) return `@app:${parts.appSlug}:${parts.appFieldKey}`
  }
  return key
}

function normalizeIdentityRole(role: IdentityRole | undefined): IdentityRole | null {
  if (!role) return null
  if (role.kind === 'match') {
    return {
      kind: 'match',
      normalize: role.normalize ?? 'none',
      exclusive: role.exclusive === true,
    }
  }
  return { kind: 'externalId', order: role.order ?? 0 }
}

/** One `FieldMapping` in its comparable form (entry id dropped, defaults made explicit). */
export function normalizeBinding(
  fm: FieldMapping,
  fieldsByDefId: ShapeResolver['fieldsByDefId']
): BindingShape {
  return {
    target: normalizeTargetRef(fm.targetFieldRef, fieldsByDefId),
    expression: fm.expression ?? '',
    sourceFields: { ...(fm.sourceFields ?? {}) },
    identityRole: normalizeIdentityRole(fm.identityRole),
    mergeStrategy: fm.mergeStrategy ?? 'overwrite',
    connectionMetaKey: fm.connectionMetaKey ?? null,
  }
}

/** The binding identity within a mapping: its normalized target (anchors have none). */
export function bindingKey(binding: Pick<BindingShape, 'target' | 'expression'>): string {
  return binding.target ?? `anchor:${binding.expression}`
}

function sortBindings(bindings: BindingShape[]): BindingShape[] {
  return [...bindings].sort((a, b) => bindingKey(a).localeCompare(bindingKey(b)))
}

/** Normalize a row's entries and index them by binding key (first wins on a duplicate). */
function indexBindings(
  fieldMappings: readonly FieldMapping[],
  fieldsByDefId: ShapeResolver['fieldsByDefId']
): { bindings: BindingShape[]; byKey: Record<string, FieldMapping> } {
  const bindings: BindingShape[] = []
  const byKey: Record<string, FieldMapping> = {}
  for (const fm of fieldMappings) {
    const binding = normalizeBinding(fm, fieldsByDefId)
    bindings.push(binding)
    byKey[bindingKey(binding)] ??= fm
  }
  return { bindings: sortBindings(bindings), byKey }
}

/** Stable hash of a mapping's comparable shape; written to `DataConnectorMapping.catalogHash`. */
export function hashMappingShape(shape: MappingShape): string {
  return sha256(
    stableStringify({
      rootPath: shape.rootPath,
      targetMode: shape.targetMode,
      targetKey: shape.targetKey,
      parentKey: shape.parentKey,
      relationshipFieldKey: shape.relationshipFieldKey,
      orphanBehavior: shape.orphanBehavior,
      bindings: shape.bindings,
    })
  )
}

/** Stable hash of a stream's comparable shape; written to `DataConnectorStream.catalogHash`. */
export function hashStreamShape(shape: StreamShape): string {
  return sha256(
    stableStringify({
      key: shape.key,
      syncMode: shape.syncMode,
      webhookTrigger: shape.webhookTrigger,
      sourceSchema: shape.sourceSchema,
    })
  )
}

/**
 * Cheap fingerprint of a deployment catalog's connector section, for the list badge:
 * "update available" needs the two deployment ids to differ AND this to differ (D2).
 */
export function hashCatalogConnectorSection(
  connector: CatalogDataConnector | null | undefined
): string {
  return sha256(stableStringify(connector ?? null))
}

/**
 * The connector section of a deployment catalog an app connector was created from.
 * Nothing on the row records which declared connector it is; every consumer today
 * (`connectorSchema`, `ownedTargets`) takes the first, so this does too.
 */
export function selectCatalogConnector(
  catalog: CatalogPayload | null | undefined
): CatalogDataConnector | null {
  return catalog?.dataConnectors?.[0] ?? null
}

// ── Derivation (what the seeder writes) ───────────────────────────────────────

/**
 * Derive the streams + mappings the seeder writes for a catalog connector: one
 * `DerivedStream` per declared stream, mappings in seeding order (owned first, parents
 * before children, then contributing). The shape is org-specific through `resolver`
 * (system def ids, their fields, adoptable owned defs), exactly as the seeder resolves
 * them.
 */
export function deriveConnectorShape(
  catalog: CatalogDataConnector,
  entities: readonly CatalogEntity[],
  appSlug: string,
  resolver: ShapeResolver
): DerivedStream[] {
  return catalog.streams.map((stream) => deriveStreamShape(stream, appSlug, entities, resolver))
}

/** An owned mapping that already exists outside the derivation (see `knownOwnedParents`). */
export interface KnownOwnedParent {
  /** Its mapping key; the persist step maps this to the existing row id. */
  key: string
  apiSlug: string
}

/**
 * Derive one stream's shape. See {@link deriveConnectorShape}. `knownOwnedParents`
 * (ABSOLUTE rootPath -> existing owned mapping) lets a contributing branch parent onto
 * an owned row the stream declaration does not carry (the standalone
 * `materializeAppContributingMappings` entry point).
 */
export function deriveStreamShape(
  declared: CatalogConnectorStream,
  appSlug: string,
  entities: readonly CatalogEntity[],
  resolver: ShapeResolver,
  knownOwnedParents: Record<string, KnownOwnedParent> = {}
): DerivedStream {
  // Catalogs published before the mapping-carries-paths shape have no `mappings`.
  const stream: CatalogConnectorStream = { ...declared, mappings: declared.mappings ?? [] }
  const owned = deriveOwnedMappings(stream, appSlug, entities, resolver)
  const contributing = deriveContributingMappings(
    stream,
    appSlug,
    owned,
    resolver,
    knownOwnedParents
  )
  return {
    key: stream.key,
    syncMode: stream.syncMode ?? 'snapshot',
    webhookTrigger: (stream.webhookTrigger as StreamWebhookTrigger | undefined) ?? null,
    sourceSchema: appCatalogStreamSchema(stream).sourceSchema,
    mappings: [...owned, ...contributing],
  }
}

function finishMapping(
  spec: Omit<
    DerivedMapping,
    | 'key'
    | 'bindings'
    | 'relationshipFieldKey'
    | 'storedRelationshipFieldKey'
    | 'fieldMappingByBindingKey'
  > & {
    relationshipFieldKey: string | null
  },
  resolver: ShapeResolver
): DerivedMapping {
  const { bindings, byKey } = indexBindings(spec.fieldMappings, resolver.fieldsByDefId)
  return {
    ...spec,
    key: mappingKey(spec.parentKey, spec.rootPath, spec.targetMode, spec.targetKey),
    storedRelationshipFieldKey: spec.relationshipFieldKey,
    relationshipFieldKey: normalizeRelationshipFieldKey(spec.relationshipFieldKey),
    bindings,
    fieldMappingByBindingKey: byKey,
  }
}

/**
 * Owned mappings (v6, Option A): one per owned default-mapping, `fieldMappings` carrying
 * the connection-late-bound `@app:` ref per declared field. Bound to an adoptable
 * app-owned def when one exists for this install (a second connector for the SAME app
 * install shares one def instead of forking), else seeded UNBOUND; the template install
 * binds the def later. `parentMappingId` nesting comes from rootPath nesting.
 */
function deriveOwnedMappings(
  stream: CatalogConnectorStream,
  appSlug: string,
  entities: readonly CatalogEntity[],
  resolver: ShapeResolver
): DerivedMapping[] {
  const entityByKey = new Map(entities.map((e) => [e.key, e]))
  const owned = stream.mappings.filter(isOwnedCatalogMapping)
  const allRootPaths = owned.map((m) => m.rootPath)
  // Parents before children so a child's parent always resolves.
  const ordered = [...owned].sort((a, b) => a.rootPath.length - b.rootPath.length)

  const byAbsoluteRootPath = new Map<string, DerivedMapping>()
  const out: DerivedMapping[] = []

  for (const mapping of ordered) {
    const entity = entityByKey.get(mapping.target.entityKey)
    if (!entity) {
      logger.warn('Owned mapping targets an undeclared entity, skipping', {
        entityKey: mapping.target.entityKey,
        streamKey: stream.key,
      })
      continue
    }
    const linkMode = mapping.linkMode ?? ('upsert' as LinkMode)
    const parentRootPath = ownedParentRootPath(mapping.rootPath, allRootPaths)
    const parent = parentRootPath != null ? byAbsoluteRootPath.get(parentRootPath) : undefined
    // The edge field lives on the PARENT def: namespace the relationship key with the
    // parent's apiSlug (cosmetic), falling back to this mapping's own slug.
    const parentSlug = parent?.apiSlug ?? entity.apiSlug

    const spec = finishMapping(
      {
        absoluteRootPath: mapping.rootPath,
        // STORE parent-relative (every consumer treats a child's stored rootPath as
        // relative to its parent); parent detection stays on the absolute path.
        rootPath: storedRootPath(mapping.rootPath, allRootPaths),
        parentKey: parent?.key ?? null,
        targetMode: 'owned',
        targetKey: entity.key,
        targetLabel: entity.key,
        linkMode,
        entityDefinitionId: resolver.ownedDefIdByEntityKey(entity.key),
        relationshipFieldKey: appRelationshipFieldKey(
          mapping.relationshipFieldKey,
          appSlug,
          parentSlug
        ),
        // A `reference` edge carries only its External-ID anchor; an upsert mapping owns
        // its subtree's columns through late-bound refs keyed on the manifest apiSlug.
        fieldMappings:
          linkMode === 'reference'
            ? [buildReferenceAnchor()]
            : buildAppOwnedFieldMappings(mapping.fields ?? [], appSlug, entity.apiSlug),
        // Incremental connectors only see the delta each run, so unseen is not deleted:
        // never archive owned orphans automatically.
        orphanBehavior: 'ignore',
        apiSlug: entity.apiSlug,
      },
      resolver
    )
    byAbsoluteRootPath.set(mapping.rootPath, spec)
    out.push(spec)
  }
  return out
}

/**
 * Contributing mappings: each merges INTO an existing system def, so the def is resolved
 * and the declared `fields` best-effort pre-bound (`match` keys first, then the rest; a
 * field that doesn't resolve is dropped). A target def the org lacks is skipped. A
 * contributing mapping can hang off an OWNED mapping or a CONTRIBUTING sibling, derived
 * from the longest boundary-prefix (owned wins at the same rootPath); the flat drilled
 * child (a SECOND mapping over the parent's own subtree) names its parent explicitly via
 * `parentRootPath` and stores rootPath `''`.
 */
function deriveContributingMappings(
  stream: CatalogConnectorStream,
  appSlug: string,
  owned: readonly DerivedMapping[],
  resolver: ShapeResolver,
  knownOwnedParents: Record<string, KnownOwnedParent>
): DerivedMapping[] {
  const ownedByAbsoluteRootPath = new Map<string, KnownOwnedParent>(
    Object.entries(knownOwnedParents)
  )
  for (const m of owned) {
    ownedByAbsoluteRootPath.set(m.absoluteRootPath, { key: m.key, apiSlug: m.apiSlug ?? '' })
  }
  const ownedRootPaths = [...ownedByAbsoluteRootPath.keys()]
  // ABSOLUTE rootPath -> the contributing spec created for it, first-wins on a shared
  // rootPath (the flat child never shadows the mapping it drilled from).
  const contributingByRootPath = new Map<string, DerivedMapping>()
  const contributing = stream.mappings.filter(isContributingCatalogMapping)
  // Parents before children: shorter rootPaths first; among same-rootPath siblings the
  // explicit `parentRootPath` declarer (the flat child) comes after its parent.
  const ordered = [...contributing].sort(
    (a, b) =>
      a.rootPath.length - b.rootPath.length ||
      (a.parentRootPath != null ? 1 : 0) - (b.parentRootPath != null ? 1 : 0)
  )
  const out: DerivedMapping[] = []

  for (const mapping of ordered) {
    const entityKind = mapping.target.entityKind
    const fields = mapping.fields ?? []

    const entityDefinitionId = resolver.entityDefIdByKind(entityKind)
    if (!entityDefinitionId) {
      logger.warn('Skipping contributing mapping, system entity not found', {
        entityKind,
        streamKey: stream.key,
      })
      continue
    }

    const defFields = resolver.fieldsByDefId(entityDefinitionId)
    // Identity-match bindings first; then author-declared non-identity field bindings
    // (or the zero-config name-match fallback when none were declared), skipping any
    // target a match key already claimed.
    const matchBindings = buildContributingMatchBindings(entityDefinitionId, fields, defFields)
    const boundTargets = new Set(matchBindings.map((b) => b.targetFieldRef))
    const valueBindings = (
      fields.length > 0
        ? buildContributingFieldBindings(entityDefinitionId, appSlug, fields, defFields)
        : buildContributingAutoBindings(
            entityDefinitionId,
            mapping.rootPath,
            stream.exampleRecord,
            defFields
          )
    ).filter((b) => !boundTargets.has(b.targetFieldRef))
    const connMetaBindings = buildContributingConnectionAppFields(
      entityDefinitionId,
      appSlug,
      mapping.connectionFields ?? []
    )
    const linkMode = mapping.linkMode ?? ('upsert' as LinkMode)
    const fieldMappings =
      linkMode === 'reference'
        ? [buildReferenceAnchor()]
        : [...matchBindings, ...valueBindings, ...connMetaBindings]

    const knownRootPaths = [...ownedRootPaths, ...contributingByRootPath.keys()]
    let parentRootPath: string | null
    if (mapping.parentRootPath != null) {
      // Explicit knob (the flat same-rootPath child). Must be a boundary prefix of, or
      // equal to, this mapping's rootPath, or the stored relativization would corrupt.
      if (isBoundaryPrefix(mapping.rootPath, mapping.parentRootPath)) {
        parentRootPath = mapping.parentRootPath
      } else {
        logger.warn('parentRootPath is not a boundary prefix of rootPath, deriving instead', {
          streamKey: stream.key,
          rootPath: mapping.rootPath,
          parentRootPath: mapping.parentRootPath,
        })
        parentRootPath = ownedParentRootPath(mapping.rootPath, knownRootPaths)
      }
    } else {
      parentRootPath = ownedParentRootPath(mapping.rootPath, knownRootPaths)
    }
    const ownedParent =
      parentRootPath != null ? ownedByAbsoluteRootPath.get(parentRootPath) : undefined
    const contribParent =
      parentRootPath != null && ownedParent == null
        ? contributingByRootPath.get(parentRootPath)
        : undefined
    const parent = ownedParent ?? contribParent ?? null
    if (parentRootPath != null && mapping.parentRootPath != null && parent == null) {
      logger.warn('parentRootPath names no materialized mapping, creating as a root', {
        streamKey: stream.key,
        rootPath: mapping.rootPath,
        parentRootPath,
      })
    }
    // The edge field lives on the PARENT def; a contributing parent's "slug" is its kind.
    const contribParentMapping =
      parentRootPath != null && ownedParent == null
        ? contributing.find((m) => m !== mapping && m.rootPath === parentRootPath)
        : undefined
    const parentSlug = ownedParent?.apiSlug ?? contribParentMapping?.target.entityKind ?? entityKind

    const spec = finishMapping(
      {
        absoluteRootPath: mapping.rootPath,
        // STORE parent-relative only when a parent was resolved; a flat child stores ''.
        rootPath:
          parentRootPath != null
            ? relativeSourcePath(mapping.rootPath, parentRootPath)
            : mapping.rootPath,
        parentKey: parent?.key ?? null,
        targetMode: 'contributing',
        targetKey: entityDefinitionId,
        targetLabel: entityKind,
        linkMode,
        entityDefinitionId,
        relationshipFieldKey: resolveRelationshipFieldKeyFromFields(
          mapping.relationshipFieldKey,
          appSlug,
          parentSlug,
          contribParent?.entityDefinitionId ?? null,
          contribParent?.entityDefinitionId
            ? resolver.fieldsByDefId(contribParent.entityDefinitionId)
            : []
        ),
        fieldMappings,
        orphanBehavior: 'ignore',
        apiSlug: null,
      },
      resolver
    )
    if (!contributingByRootPath.has(mapping.rootPath)) {
      contributingByRootPath.set(mapping.rootPath, spec)
    }
    out.push(spec)
  }
  return out
}

// ── Persisted rows back into the comparable shape ─────────────────────────────

/** Org lookups needed to read persisted rows back into the shape. */
export interface PersistedShapeContext {
  fieldsByDefId: ShapeResolver['fieldsByDefId']
  /** Bound owned rows: the def's `sourceKey` (== manifest `entityKey`). */
  ownedEntityKeyByDefId: (entityDefinitionId: string) => string | undefined
  /** Unbound owned rows: the late-bound ref's apiSlug segment -> manifest `entityKey`. */
  entityKeyByApiSlug: (apiSlug: string) => string | undefined
  /** Contributing rows: def id -> the system entity kind (for labels). */
  entityKindByDefId: (entityDefinitionId: string) => string | undefined
}

/**
 * Read persisted streams + mapping rows into the comparable shape. Mapping keys are
 * rebuilt from the parent chain the same way the derivation builds them; an owned row
 * whose target cannot be named (no def, no late-bound ref) gets targetKey `?`, which
 * the diff pairs by parent + rootPath alone.
 */
export function shapeFromPersistedStreams(
  streams: readonly StreamWithRawMappings[],
  ctx: PersistedShapeContext
): PersistedStream[] {
  return streams.map((row) => {
    const byId = new Map(row.mappings.map((m) => [m.id, m]))
    const shapes = new Map<string, PersistedMapping>()

    const shapeOf = (m: StreamWithRawMappings['mappings'][number]): PersistedMapping => {
      const cached = shapes.get(m.id)
      if (cached) return cached
      const parentRow = m.parentMappingId ? byId.get(m.parentMappingId) : undefined
      const parentKey = parentRow ? shapeOf(parentRow).shape.key : null
      const targetMode = m.targetMode as TargetMode
      const { targetKey, targetLabel } = persistedTarget(m, targetMode, ctx)
      const { bindings, byKey } = indexBindings(m.fieldMappings ?? [], ctx.fieldsByDefId)
      const persisted: PersistedMapping = {
        row: m,
        shape: {
          key: mappingKey(parentKey, m.rootPath, targetMode, targetKey),
          parentKey,
          rootPath: m.rootPath,
          targetMode,
          targetKey,
          targetLabel,
          relationshipFieldKey: normalizeRelationshipFieldKey(m.relationshipFieldKey),
          orphanBehavior: m.orphanBehavior as OrphanBehavior,
          bindings,
        },
        fieldMappingByBindingKey: byKey,
      }
      shapes.set(m.id, persisted)
      return persisted
    }

    return {
      row,
      shape: {
        key: row.streamKey ?? '',
        syncMode: row.syncMode as SyncMode,
        webhookTrigger: row.requestConfig?.webhookTrigger ?? null,
        sourceSchema: row.sourceSchema ?? null,
      },
      mappings: row.mappings.map(shapeOf),
    }
  })
}

function persistedTarget(
  m: StreamWithRawMappings['mappings'][number],
  targetMode: TargetMode,
  ctx: PersistedShapeContext
): { targetKey: string; targetLabel: string } {
  if (targetMode === 'contributing') {
    const defId = m.entityDefinitionId ?? '?'
    return { targetKey: defId, targetLabel: ctx.entityKindByDefId(defId) ?? defId }
  }
  if (m.entityDefinitionId) {
    const key = ctx.ownedEntityKeyByDefId(m.entityDefinitionId)
    if (key) return { targetKey: key, targetLabel: key }
  }
  for (const fm of m.fieldMappings ?? []) {
    const parts = fm.targetFieldRef ? parseAppFieldRef(fm.targetFieldRef) : null
    if (!parts) continue
    const key = ctx.entityKeyByApiSlug(parts.defSegment) ?? parts.defSegment
    return { targetKey: key, targetLabel: key }
  }
  return { targetKey: '?', targetLabel: 'record type' }
}
