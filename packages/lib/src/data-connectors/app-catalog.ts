// packages/lib/src/data-connectors/app-catalog.ts
// Pure helpers for materializing an installed app's catalog data-connector into the
// setup surface (create-sync-flow §3.1, Tier 1). Kept dependency-light (no
// drizzle/bullmq) so it's unit-testable in isolation; `mutations.ts` composes these
// with the DB write helpers in `createConnectorFromAppCatalog`.
//
// app-fields-and-entities-plan Phase 2 §4.3: the mapping is now the unit that
// carries source paths — every field's `sourcePath` is already RELATIVE to its
// own mapping's `rootPath` (the SDK's `ConnectorOwnedMappingField` /
// `ConnectorContributingMappingField` contract), so the old stream-wide flat
// field map, the longest-prefix owned partitioner, and the three parallel
// contributing binding lists (`matchFieldKeys`/`fieldBindings`/
// `connectionAppFields`) are gone. A contributing mapping declares its intent
// directly per field (`target` / `appField` / `match` / `mergeStrategy`).

import type {
  CatalogConnectorConnectionField,
  CatalogConnectorContributingMappingField,
  CatalogConnectorMapping,
  CatalogConnectorOwnedMappingField,
  CatalogConnectorStream,
} from '@auxx/database'
import { toAppFieldRef, toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { BadRequestError } from '../errors'
import { inferJsonSchema, STRUCT_FIELD_TYPE_KEYWORD } from '../json-schema'
import type { FieldMapping, FieldMergeStrategy, IdentityNormalize } from './types'

/** A catalog source field's declared type → the JSON-schema scalar type it carries. */
function jsonTypeForCatalogField(type: string | undefined): string {
  switch (type) {
    case 'NUMBER':
    case 'CURRENCY':
      return 'number'
    case 'CHECKBOX':
      return 'boolean'
    default:
      return 'string'
  }
}

/**
 * Build a Layer-A source JSON schema from an app connector's declared source
 * fields when it ships no `exampleRecord`. Each absolute `sourcePath`
 * (`total_price`, `customer.email`, `line_items[].sku`) is walked into a
 * nested object/array shape — the same shape `inferJsonSchema(exampleRecord)`
 * would produce — so the setup mapping tree + the Tier 2 suggester have a
 * schema to work against.
 */
export function buildSchemaFromFieldPaths(
  fields: Array<{ sourcePath: string; type?: string }>
): Record<string, unknown> {
  const root: Record<string, unknown> = { type: 'object', properties: {} }
  for (const f of fields) {
    const segs = f.sourcePath.split('.').filter(Boolean)
    let node: Record<string, unknown> = root
    segs.forEach((rawSeg, i) => {
      const isLast = i === segs.length - 1
      const isArray = rawSeg.endsWith('[]')
      const seg = isArray ? rawSeg.slice(0, -2) : rawSeg
      const props = (node.properties ??= {}) as Record<string, Record<string, unknown>>
      const leafType = jsonTypeForCatalogField(f.type)
      if (isArray) {
        let arr = props[seg]
        if (!arr || arr.type !== 'array') {
          arr = {
            type: 'array',
            items: isLast ? { type: leafType } : { type: 'object', properties: {} },
          }
          props[seg] = arr
        }
        // Descend into the element shape for deeper segments; an array of scalars
        // (the leaf case) has nothing further to walk into.
        if (!isLast) node = arr.items as Record<string, unknown>
      } else if (isLast) {
        props[seg] = { type: leafType }
      } else {
        let obj = props[seg]
        if (!obj || obj.type !== 'object') {
          obj = { type: 'object', properties: {} }
          props[seg] = obj
        }
        node = obj
      }
    })
  }
  return root
}

/** Lowercase, strip non-alphanumerics so `first_name` ↔ `firstName` ↔ `First Name` collide. */
function normalizeFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The match `normalize` strategy a target field's storage type implies (mirrors the editor). */
function deriveNormalizeFromType(type: string): IdentityNormalize {
  if (type === 'EMAIL') return 'email'
  if (type === 'PHONE_INTL') return 'phone'
  if (type === 'URL') return 'domain'
  return 'none'
}

/** The subset of a target field the contributing-match binder needs (cache-shaped). */
export interface ContributingTargetField {
  id: string
  name: string
  systemAttribute: string | null
  /** Storage field type (EMAIL / PHONE_INTL / URL / …) → the match `normalize` strategy. */
  type: string
  /**
   * Capability flags — present on the cached `CustomFieldEntity`, undefined on the
   * test/literal shape. The zero-config auto-binder ({@link buildContributingAutoBindings})
   * and the explicit-binder reserved-target guard ({@link assertContributingTargetWritable})
   * both read them to keep a connector off non-writable / computed targets (`id`,
   * `created_at`, the computed `fullName`).
   */
  isCreatable?: boolean
  isUpdatable?: boolean
  isComputed?: boolean
  /** The app-declared `appFieldKey` this row provisioned from, if any (null for system attrs). */
  appFieldKey?: string | null
  /** Stamped by provisioning when the declaring `defineFields` entry is `identity: true`. */
  isIdentity?: boolean
  /** Owning app's slug, stamped by provisioning — scopes `appField` matches to the
   *  connector's OWN app so a sibling app's identically-keyed field (Stripe `customerId` vs
   *  Shopify `customerId`) can't satisfy the match. Rows provisioned before slug-stamping
   *  have `null` and fail closed (the reconciler re-stamps `appSlug` on every sync). */
  appSlug?: string | null
}

/** A target is a safe auto-bind sink unless it's computed or can be neither created nor updated. */
function isWritableTarget(field: ContributingTargetField): boolean {
  if (field.isComputed) return false
  if (field.isCreatable === false && field.isUpdatable === false) return false
  return true
}

/**
 * Sell-side totals a connector is allowed to write despite being flagged
 * `isCreatable: false, isUpdatable: false` for the UI (a human can't hand-edit
 * them, but a connector TRANSCRIBES them from the upstream provider — the way
 * `vendor_bill` already writes purchase-order totals). Keyed by
 * `systemAttribute`. See plans/money/tasks/37-shopify-native-retarget.md §6.
 */
export const CONNECTOR_WRITABLE_TOTALS_ALLOWLIST = new Set([
  'order_subtotal',
  'order_discount_type',
  'order_discount_value',
  'order_tax_total',
  'order_shipping_total',
  'order_total',
  'line_item_line_total',
  'quote_subtotal',
  'quote_discount_type',
  'quote_discount_value',
  'quote_tax_total',
  'quote_total',
  'invoice_subtotal',
  'invoice_discount_type',
  'invoice_discount_value',
  'invoice_tax_total',
  'invoice_total',
])

/**
 * Refuse an explicit contributing `target` binding that resolves to a computed
 * field, or one flagged neither creatable nor updatable — the reserved-target
 * check the SDK extractor cannot run (its `RESERVED_SYSTEM_ATTRIBUTES` is a
 * static list; this is resolved against the LIVE `CustomField` row's
 * capabilities). The zero-config auto-binder already skips these silently via
 * {@link isWritableTarget} (never guess); an author who NAMES the target
 * explicitly gets a hard error instead, so a manifest can't quietly bind onto
 * `record_id` or a computed rollup. {@link CONNECTOR_WRITABLE_TOTALS_ALLOWLIST}
 * is the one exception — a connector transcribes those by design.
 */
export function assertContributingTargetWritable(
  targetKey: string,
  target: ContributingTargetField
): void {
  if (isWritableTarget(target)) return
  if (target.systemAttribute && CONNECTOR_WRITABLE_TOTALS_ALLOWLIST.has(target.systemAttribute)) {
    return
  }
  throw new BadRequestError(
    `Contributing field target "${targetKey}" is a read-only or computed field and cannot be bound by a connector`
  )
}

/**
 * Pre-bind a contributing mapping's declared identity-match fields (`match: true`)
 * into `FieldMapping` entries flagged `match` (the secondary-identity link the sink
 * merges on, e.g. an existing contact by `email`). Pure (caller supplies `defFields`)
 * so it's unit-testable without the org cache. Only `target`-style fields (not
 * `appField`) can carry a match key — matching against a connection-scoped app field
 * has no meaning. A field's `sourcePath` is already relative to the mapping's
 * `rootPath` (the SDK contract), so no boundary-prefix/relativize step is needed here.
 */
export function buildContributingMatchBindings(
  entityDefinitionId: string,
  fields: readonly CatalogConnectorContributingMappingField[],
  defFields: ContributingTargetField[]
): FieldMapping[] {
  const fieldByKey = buildTargetFieldIndex(defFields)
  const bindings: FieldMapping[] = []
  for (const field of fields) {
    if (!field.match || !field.target) continue
    const target = fieldByKey.get(field.target) ?? fieldByKey.get(normalizeFieldKey(field.target))
    if (!target) continue
    assertContributingTargetWritable(field.target, target)
    bindings.push(
      bindSourceToTarget(entityDefinitionId, field.sourcePath, target, field.mergeStrategy, {
        kind: 'match',
        normalize: deriveNormalizeFromType(target.type),
      })
    )
  }
  return bindings
}

/**
 * Bind a contributing mapping's declared non-match fields — either onto the
 * target def's own attribute (`target`) or onto a `defineFields` app field
 * (`appField`, today's `targetAppField`, auto-stamping `identityRole:
 * externalId` when that app field is itself `identity: true`). The symmetric
 * counterpart to {@link buildContributingMatchBindings}; both are fed from the
 * SAME mapping `fields` list (the caller filters `match` fields out via
 * {@link buildContributingMatchBindings} first, so a target claimed by a match
 * key isn't rebound here as a plain value).
 */
export function buildContributingFieldBindings(
  entityDefinitionId: string,
  appSlug: string,
  fields: readonly CatalogConnectorContributingMappingField[],
  defFields: ContributingTargetField[]
): FieldMapping[] {
  const fieldByKey = buildTargetFieldIndex(defFields)
  const bindings: FieldMapping[] = []
  for (const field of fields) {
    if (field.match) continue // handled by buildContributingMatchBindings

    if (field.appField) {
      // App fields are CONNECTION-SCOPED — an org with multiple connections of the same
      // app has one `CustomField` per connection (e.g. a `customerId` per Shopify store),
      // so matching by `appFieldKey` alone is ambiguous. `identity` is a manifest constant
      // across a field's connection-scoped copies, so a stale pre-feature copy
      // (`isIdentity=false`) must not mask a correctly-stamped one: treat the app field as
      // identity iff ANY copy is. The concrete field is resolved connection-scoped at sync
      // (the late-bound `@app:` ref), so this branch only needs the flag — never `.find()`
      // the first arbitrary row and read its label.
      // Scope the match to this connector's OWN app (`appSlug`) — matching by
      // `appFieldKey` alone let a sibling app's identically-keyed field satisfy the
      // check (Stripe `customerId` for Shopify's binder). A `null`-slug row (provisioned
      // before slug-stamping) fails closed; the reconciler re-stamps it on the next sync.
      const matches = defFields.filter(
        (f) => f.appFieldKey === field.appField && f.appSlug === appSlug
      )
      if (matches.length === 0) continue
      const isIdentityField = matches.some((f) => f.isIdentity)
      bindings.push(
        bindSourceToAppField(
          entityDefinitionId,
          appSlug,
          field.appField,
          field.sourcePath,
          field.mergeStrategy,
          isIdentityField ? { kind: 'externalId' } : undefined
        )
      )
      continue
    }

    if (field.target) {
      const target = fieldByKey.get(field.target) ?? fieldByKey.get(normalizeFieldKey(field.target))
      if (!target) continue
      assertContributingTargetWritable(field.target, target)
      bindings.push(
        bindSourceToTarget(entityDefinitionId, field.sourcePath, target, field.mergeStrategy)
      )
    }

    // A source-only field (no `target`/`appField`) is projection-only — Layer A schema
    // needs its declared `type`/`name`, but there is nothing to bind.
  }
  return bindings
}

/**
 * Build the `FieldMapping[]` for a contributing mapping's `connectionFields` —
 * plain (never identity) app fields filled from the connector's CONNECTION METADATA
 * (e.g. Shopify `shopDomain`) rather than the source record. The only synthetic
 * write channel: no source binding, so `expression`/`sourceFields` are unused and
 * `connectionMetaKey` carries the metadata key the sink reads at write time
 * (`ctx.connectionMeta`). Always the late-bound `@app:` ref — connection metadata is
 * per-connection by nature, same reasoning as `appField`.
 */
export function buildContributingConnectionAppFields(
  entityDefinitionId: string,
  appSlug: string,
  connectionFields: readonly CatalogConnectorConnectionField[]
): FieldMapping[] {
  return connectionFields.map(({ appField, from }) => ({
    id: generateId(),
    targetFieldRef: toAppFieldRef(entityDefinitionId, appSlug, appField),
    expression: '',
    sourceFields: {},
    connectionMetaKey: from,
  }))
}

/** Extract the first representative element at `rootPath` within a static sample record —
 *  same array/dot path syntax `mapRecord` uses at sync time (`line_items[]` picks the
 *  first element to preview, others descend by key). Used ONLY to enumerate zero-config
 *  auto-bind LEAF candidates from a stream's `exampleRecord`; the real per-record
 *  extraction is `mapRecord`'s own. */
function sampleSubtree(source: unknown, rootPath: string): unknown {
  if (rootPath === '') return source
  let node: unknown = source
  for (const rawSeg of rootPath.split('.').filter(Boolean)) {
    const isArray = rawSeg.endsWith('[]')
    const seg = isArray ? rawSeg.slice(0, -2) : rawSeg
    if (node == null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[seg]
    if (isArray) node = Array.isArray(node) ? node[0] : undefined
  }
  return node
}

/** LEAF (scalar/null) keys directly on a sample object — nested objects and arrays
 *  excluded, same restriction the old flat-field auto-binder applied. */
function leafKeys(sample: unknown): string[] {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return []
  return Object.entries(sample as Record<string, unknown>)
    .filter(([, v]) => v === null || typeof v !== 'object')
    .map(([k]) => k)
}

/**
 * Zero-config fallback for a contributing mapping that declared NO explicit
 * `fields` (approach B, automap-plan §5): name-match every LEAF key of the
 * mapping's `rootPath` subtree (sampled from the stream's `exampleRecord`) to a
 * target field, binding only UNAMBIGUOUS, writable hits. Lets a contributing
 * stream land first/last/phone pre-mapped even when the app author writes no
 * `fields` boilerplate — explicit `fields` always take precedence (the caller
 * runs this only when none were declared).
 *
 * Conservative by construction:
 *   - only LEAF keys directly on the sampled root object;
 *   - a target two source keys both resolve to is AMBIGUOUS and dropped (never guess);
 *   - non-writable / computed targets (`id`, `created_at`, the computed `fullName`) are
 *     skipped via {@link isWritableTarget} — never a hard error (this path is automatic,
 *     not an author's explicit choice);
 *   - emits plain (no `identityRole`) `FieldMapping`s; the external id is never bound;
 *   - no `exampleRecord` ⇒ no candidates ⇒ empty result (nothing to guess from).
 */
export function buildContributingAutoBindings(
  entityDefinitionId: string,
  rootPath: string,
  exampleRecord: Record<string, unknown> | undefined,
  defFields: ContributingTargetField[]
): FieldMapping[] {
  const sample = exampleRecord ? sampleSubtree(exampleRecord, rootPath) : undefined
  const keys = leafKeys(sample)
  const fieldByKey = buildTargetFieldIndex(defFields)

  // Group candidates by resolved target id so a target claimed by 2+ sources is ambiguous.
  const byTarget = new Map<string, { sourcePath: string; target: ContributingTargetField }[]>()
  for (const key of keys) {
    const target = fieldByKey.get(key) ?? fieldByKey.get(normalizeFieldKey(key))
    if (!target || !isWritableTarget(target)) continue
    const list = byTarget.get(target.id) ?? []
    list.push({ sourcePath: key, target })
    byTarget.set(target.id, list)
  }

  const bindings: FieldMapping[] = []
  for (const candidates of byTarget.values()) {
    if (candidates.length !== 1) continue // ambiguous → skip
    const { sourcePath, target } = candidates[0]!
    bindings.push(bindSourceToTarget(entityDefinitionId, sourcePath, target))
  }
  return bindings
}

/** Build the target-field lookup keyed by systemAttribute / name (+ normalized). */
function buildTargetFieldIndex(
  defFields: ContributingTargetField[]
): Map<string, ContributingTargetField> {
  const fieldByKey = new Map<string, ContributingTargetField>()
  for (const fld of defFields) {
    if (fld.systemAttribute) {
      fieldByKey.set(fld.systemAttribute, fld)
      fieldByKey.set(normalizeFieldKey(fld.systemAttribute), fld)
    }
    fieldByKey.set(fld.name, fld)
    fieldByKey.set(normalizeFieldKey(fld.name), fld)
  }
  return fieldByKey
}

/**
 * Construct one `FieldMapping` binding a resolved (already mapping-relative)
 * `sourcePath` to a resolved target, carrying the declared `mergeStrategy`
 * (§2.4) onto the row. Pass `identityRole` to flag it a secondary-identity
 * match; omit for a plain value binding.
 */
function bindSourceToTarget(
  entityDefinitionId: string,
  sourcePath: string,
  target: ContributingTargetField,
  mergeStrategy?: FieldMergeStrategy,
  identityRole?: FieldMapping['identityRole']
): FieldMapping {
  return {
    id: generateId(),
    targetFieldRef: toResourceFieldId(entityDefinitionId, target.id),
    expression: `{${sourcePath}}`,
    sourceFields: { [sourcePath]: sourcePath },
    ...(identityRole ? { identityRole } : {}),
    ...(mergeStrategy ? { mergeStrategy } : {}),
  }
}

/**
 * Same as {@link bindSourceToTarget}, but for an `appField` binding: the target is
 * an app-declared field named by `appFieldKey`, resolved to the connection-late-bound
 * `@app:` ref (never a concrete id — the field may be connection-scoped, so resolution
 * defers to sync time against the connector's bound connection, same as owned identity
 * fields).
 */
function bindSourceToAppField(
  entityDefinitionId: string,
  appSlug: string,
  appFieldKey: string,
  sourcePath: string,
  mergeStrategy?: FieldMergeStrategy,
  identityRole?: FieldMapping['identityRole']
): FieldMapping {
  return {
    id: generateId(),
    targetFieldRef: toAppFieldRef(entityDefinitionId, appSlug, appFieldKey),
    expression: `{${sourcePath}}`,
    sourceFields: { [sourcePath]: sourcePath },
    ...(identityRole ? { identityRole } : {}),
    ...(mergeStrategy ? { mergeStrategy } : {}),
  }
}

/**
 * Source field types that carry a STRUCT value (one nested object that maps as a
 * single value, not a branch to explode). The schema overlay stamps these so the
 * mapping editor renders the node as a typed value leaf bound to a matching target
 * field — see plans/data-connectors/v6/address-struct-mapping-plan.md. `NAME` is a
 * candidate but lacks a JSON/object compat entry today, so it stays out for now.
 */
export const STRUCT_SOURCE_FIELD_TYPES = new Set(['ADDRESS_STRUCT'])

interface MutableSchemaNode {
  type?: string | string[]
  format?: string
  properties?: Record<string, MutableSchemaNode>
  items?: MutableSchemaNode
  [key: string]: unknown
}

/**
 * A node's effective (non-null) JSON type. `null` when the node carries no type
 * information at all — a null-only example value (`{ type: 'null' }`) or an empty
 * `items: {}` from an empty sampled array — i.e. nothing worth merging.
 */
function schemaNodeType(node: MutableSchemaNode): string | null {
  const t = node.type
  if (Array.isArray(t)) return t.find((x) => x !== 'null') ?? null
  if (t === 'null') return null
  return t ?? (node.properties ? 'object' : null)
}

/** Descend a dotted, `[]`-aware `sourcePath` into the inferred schema. Null if absent. */
function findSchemaNode(root: MutableSchemaNode, sourcePath: string): MutableSchemaNode | null {
  let node: MutableSchemaNode | undefined = root
  for (const rawSeg of sourcePath.split('.').filter(Boolean)) {
    const isArray = rawSeg.endsWith('[]')
    const seg = isArray ? rawSeg.slice(0, -2) : rawSeg
    // Annotated: `node` is reassigned from `child` below, so leaving `child`'s type to
    // inference makes the two mutually circular and TS falls back to implicit `any`.
    const child: MutableSchemaNode | undefined = node?.properties?.[seg]
    if (!child) return null
    // An array property carries its element shape under `items` — descend into it so a
    // path segment like `line_items[]` lands on the element, not the array container.
    node = isArray && child.type === 'array' && child.items ? child.items : child
  }
  return node ?? null
}

/**
 * Stamp each declared field's type ({@link STRUCT_FIELD_TYPE_KEYWORD}) onto the schema
 * node at its absolute `sourcePath`, so the mapping editor's badge/picker and the
 * suggester see the DECLARED type (`CURRENCY`, `SINGLE_SELECT`, …) instead of the bare
 * JSON scalar. STRUCT types additionally make the flatteners treat the node as a single
 * typed value leaf instead of an object branch — so a non-struct type is never stamped
 * on a branch node (an object, or an array of objects: a mis-declared manifest must not
 * collapse a real branch or a fan-out subtree). Mutates `schema` in place (it's freshly
 * built by the caller).
 */
export function overlayDeclaredFieldTypes(
  schema: Record<string, unknown>,
  fields: Array<{ sourcePath: string; type: string }>
): Record<string, unknown> {
  const root = schema as MutableSchemaNode
  for (const f of fields) {
    const node = findSchemaNode(root, f.sourcePath)
    if (!node) continue
    const t = schemaNodeType(node)
    const isBranch =
      t === 'object' ||
      (t === 'array' && node.items != null && schemaNodeType(node.items) === 'object')
    if (STRUCT_SOURCE_FIELD_TYPES.has(f.type) || !isBranch) {
      node[STRUCT_FIELD_TYPE_KEYWORD] = f.type
    }
  }
  return schema
}

/**
 * Merge the example-inferred schema ONTO the declaration-derived one, in place. The
 * declared fields are the contract — every declared `sourcePath` survives even when
 * the `exampleRecord` omits it — while the example contributes wire truth: the actual
 * scalar type where the declaration's guess disagrees (Shopify money is a `"19.99"`
 * string, not a number), detected string `format`s, and any extra shape the
 * declaration doesn't cover.
 */
function mergeExampleNode(declared: MutableSchemaNode, example: MutableSchemaNode): void {
  const exType = schemaNodeType(example)
  if (exType === null) return // null-only / empty example node — the declaration stands
  const decType = schemaNodeType(declared)

  if (exType === 'object' && decType === 'object') {
    const decProps = (declared.properties ??= {})
    for (const [key, exChild] of Object.entries(example.properties ?? {})) {
      const decChild = decProps[key]
      if (decChild) mergeExampleNode(decChild, exChild)
      else decProps[key] = exChild
    }
    return
  }
  if (exType === 'array' && decType === 'array') {
    if (declared.items && example.items) mergeExampleNode(declared.items, example.items)
    else if (example.items) declared.items = example.items
    return
  }

  // Scalar refinement or shape disagreement — the example is wire truth; replace the node.
  declared.type = example.type
  if (example.format !== undefined) declared.format = example.format
  else delete declared.format
  if (example.properties) declared.properties = example.properties
  else delete declared.properties
  if (example.items) declared.items = example.items
  else delete declared.items
}

/** Join a mapping's `rootPath` with one of its field's (already relative) `sourcePath`
 *  into the PAYLOAD-ABSOLUTE path the Layer A schema is built from. */
function joinSourcePath(rootPath: string, sourcePath: string): string {
  return rootPath ? `${rootPath}.${sourcePath}` : sourcePath
}

/**
 * Union every mapping's absolute source paths (`rootPath` + field `sourcePath`) into
 * one flat `{ sourcePath, type? }[]` — the Layer A schema's declared-field contract.
 * Owned fields always carry a declared `type` (normalized from the entity's own field
 * at extract time); a contributing field carries one only when it is source-only (no
 * `target`/`appField` to resolve a type from) — the mapping editor still infers the
 * rest from `exampleRecord`. See §2.4 "Layer A source schema" in the plan.
 */
export function collectStreamSourceFields(
  stream: CatalogConnectorStream
): Array<{ sourcePath: string; type?: string }> {
  const out: Array<{ sourcePath: string; type?: string }> = []
  for (const mapping of stream.mappings) {
    for (const field of mapping.fields ?? []) {
      const sourcePath = joinSourcePath(mapping.rootPath, field.sourcePath)
      out.push({ sourcePath, type: 'type' in field ? field.type : undefined })
    }
  }
  return out
}

/** Narrow {@link collectStreamSourceFields}'s output to entries with a declared type,
 *  the shape {@link overlayDeclaredFieldTypes} needs. */
function declaredTypedFields(
  fields: Array<{ sourcePath: string; type?: string }>
): Array<{ sourcePath: string; type: string }> {
  return fields.filter((f): f is { sourcePath: string; type: string } => f.type != null)
}

/**
 * The source schema for an app catalog stream — DEFINITION-first. The union of every
 * mapping's declared field paths drives which paths exist (they are the projection
 * contract; the `exampleRecord` is an illustration, so a field missing from the
 * example must still appear in the mapping tree); the example refines scalar
 * types/formats and adds undeclared shape (including every contributing `target`/
 * `appField` binding, whose type is resolved from the existing target rather than
 * declared here). Declared field types ride each leaf via
 * {@link overlayDeclaredFieldTypes}.
 */
export function appCatalogStreamSchema(stream: CatalogConnectorStream): {
  sourceSchema: Record<string, unknown>
  schemaSource: 'catalog'
} {
  const fields = collectStreamSourceFields(stream)
  const sourceSchema = buildSchemaFromFieldPaths(fields)
  if (stream.exampleRecord) {
    mergeExampleNode(
      sourceSchema as MutableSchemaNode,
      inferJsonSchema(stream.exampleRecord) as MutableSchemaNode
    )
  }
  overlayDeclaredFieldTypes(sourceSchema, declaredTypedFields(fields))
  return { sourceSchema, schemaSource: 'catalog' }
}

/**
 * `CatalogConnectorMapping.fields` is declared as the OR of both field shapes
 * (the DB mirror can't discriminate it off `target` the way the SDK's
 * `OwnedConnectorMapping | ContributingConnectorMapping` union does), so a
 * plain `'entityKey' in mapping.target` check narrows `target` but not
 * `fields`. These re-type the whole mapping so callers get a properly
 * narrowed `fields` array too.
 */
export type OwnedCatalogMapping = Omit<CatalogConnectorMapping, 'target' | 'fields'> & {
  target: { entityKey: string }
  fields?: CatalogConnectorOwnedMappingField[]
}

export type ContributingCatalogMapping = Omit<CatalogConnectorMapping, 'target' | 'fields'> & {
  target: { entityKind: string }
  fields?: CatalogConnectorContributingMappingField[]
}

/** Narrow a catalog mapping to an OWNED one (`target: { entityKey }`). */
export function isOwnedCatalogMapping(
  mapping: CatalogConnectorMapping
): mapping is OwnedCatalogMapping {
  return 'entityKey' in mapping.target
}

/** Narrow a catalog mapping to a CONTRIBUTING one (`target: { entityKind }`). */
export function isContributingCatalogMapping(
  mapping: CatalogConnectorMapping
): mapping is ContributingCatalogMapping {
  return 'entityKind' in mapping.target
}
