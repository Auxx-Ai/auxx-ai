// packages/lib/src/data-connectors/app-catalog.ts
// Pure helpers for materializing an installed app's catalog data-connector into the
// setup surface (create-sync-flow §3.1, Tier 1). Kept dependency-light (no
// drizzle/bullmq) so it's unit-testable in isolation; `mutations.ts` composes these
// with the DB write helpers in `createConnectorFromAppCatalog`.

import type { CatalogDataConnector } from '@auxx/database'
import { toAppFieldRef, toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { inferJsonSchema, STRUCT_FIELD_TYPE_KEYWORD } from '../json-schema'
import { isBoundaryPrefix, relativeSourcePath } from './source-paths'
import type { FieldMapping, IdentityNormalize } from './types'

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
 * fields when it ships no `exampleRecord`. Each `sourcePath` (`total_price`,
 * `customer.email`, `line_items[].sku`) is walked into a nested object/array
 * shape — the same shape `inferJsonSchema(exampleRecord)` would produce — so the
 * setup mapping tree + the Tier 2 suggester have a schema to work against.
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
   * test/literal shape. Only the zero-config auto-binder ({@link buildContributingAutoBindings})
   * reads them, to skip non-writable / computed targets (`id`, `created_at`, the computed
   * `fullName`). The explicit binders ignore them — an author who names a target owns the choice.
   */
  isCreatable?: boolean
  isUpdatable?: boolean
  isComputed?: boolean
  /** The app-declared `appFieldKey` this row provisioned from, if any (null for system attrs). */
  appFieldKey?: string | null
  /** Stamped by provisioning when the declaring `defineFields` entry is `identity: true`. */
  isIdentity?: boolean
  /** Owning app's slug, stamped by provisioning — scopes `targetAppField` matches to the
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
 * Pre-bind a contributing mapping's declared identity-match keys into `FieldMapping`
 * entries flagged `match` (the secondary-identity link the sink merges on, e.g. an
 * existing contact by `email`). Pure (caller supplies `defFields`) so it's unit-testable
 * without the org cache. A key binds only when it resolves UNAMBIGUOUSLY on both sides:
 *   - source — a declared stream field whose absolute `sourcePath` is the key under
 *     the mapping's `rootPath` (`customer` + `email` → `customer.email`; an array
 *     root relativizes the same way — `variants[]` + `sku` → `variants[].sku`); the
 *     stored `sourceFields` path is subtree-relative (`email`, `sku`), matching how
 *     `mapRecord` evaluates a rooted mapping;
 *   - target — a field on the contributing def keyed by that match key (its
 *     `systemAttribute`, name, or normalized name).
 * Unresolved keys, and keys whose subtree-relative path crosses a NESTED array
 * (a digit-less `[]` that `mapRecord.getByPath` cannot resolve), are dropped
 * (the row stays a `needs-mapping` draft). See multi-stream-setup-plan §5.2.
 */
export function buildContributingMatchBindings(
  entityDefinitionId: string,
  rootPath: string,
  matchFieldKeys: string[],
  sourceFields: CatalogDataConnector['streams'][number]['fields'],
  defFields: ContributingTargetField[]
): FieldMapping[] {
  if (matchFieldKeys.length === 0) return []

  const fieldByKey = buildTargetFieldIndex(defFields)
  const bindings: FieldMapping[] = []
  for (const key of matchFieldKeys) {
    // The key IS the subtree-relative path; one crossing a further array
    // (`options[].value`) keeps a `[]` no per-record path can resolve — skip it.
    if (key.includes('[]')) continue
    const target = fieldByKey.get(key) ?? fieldByKey.get(normalizeFieldKey(key))
    if (!target) continue
    const absolutePath = rootPath ? `${rootPath}.${key}` : key
    const sourceField = sourceFields.find((f) => f.sourcePath === absolutePath)
    if (!sourceField) continue
    bindings.push(
      bindSourceToTarget(entityDefinitionId, rootPath, sourceField, target, {
        kind: 'match',
        normalize: deriveNormalizeFromType(target.type),
      })
    )
  }
  return bindings
}

/**
 * Pre-bind a contributing mapping's author-declared NON-identity `fieldBindings`
 * (e.g. `first_name` → contact's first-name attribute) into plain `FieldMapping`
 * entries (no `identityRole`) — the symmetric counterpart to
 * {@link buildContributingMatchBindings}. Lets an app author state how a stream's
 * fields land in the contributing def so the stream is born closer to `ready` instead
 * of a bare identity-only draft (multi-stream-setup-plan §3.4A). A binding resolves
 * only when BOTH sides resolve unambiguously:
 *   - source — a declared stream field by `fieldKey` (`binding.sourceFieldKey`);
 *   - target — either `targetKey` against a field on the contributing def (its
 *     `systemAttribute`, name, or normalized name), OR `targetAppField` (mutually
 *     exclusive) against a declared app field's `appFieldKey` — resolved to the
 *     connection-late-bound `@app:` ref (not a concrete id, since the field may be
 *     connection-scoped) via `toAppFieldRef`. A `targetAppField` binding whose app
 *     field is `identity: true` auto-stamps `identityRole: { kind: 'externalId' }`
 *     (the `isExternalId` mechanism, extended to contributing).
 * Unresolved bindings, sources outside the mapping's subtree, and sources whose
 * subtree-relative path crosses a NESTED array are dropped (the row keeps whatever
 * draft state remains). The external id is never bound via `targetKey`.
 */
export function buildContributingFieldBindings(
  entityDefinitionId: string,
  appSlug: string,
  rootPath: string,
  fieldBindings: { sourceFieldKey: string; targetKey?: string; targetAppField?: string }[],
  sourceFields: CatalogDataConnector['streams'][number]['fields'],
  defFields: ContributingTargetField[]
): FieldMapping[] {
  if (fieldBindings.length === 0) return []

  const fieldByKey = buildTargetFieldIndex(defFields)
  const bindings: FieldMapping[] = []
  for (const { sourceFieldKey, targetKey, targetAppField } of fieldBindings) {
    const sourceField = sourceFields.find((f) => f.fieldKey === sourceFieldKey)
    // The source field must live under this mapping's subtree at a PATH BOUNDARY
    // (`customer` must not claim `customer_notes.body`), and its subtree-relative
    // path must not cross a further array — `variants[].options[].value` under root
    // `variants[]` relativizes to `options[].value`, a digit-less `[]` that
    // `mapRecord.getByPath` cannot resolve. A named array ROOT itself is fine:
    // `variants[].sku` → `sku`, same as the owned partitioner.
    if (!sourceField || !isBoundaryPrefix(sourceField.sourcePath, rootPath)) continue
    const relative = relativeSourcePath(sourceField.sourcePath, rootPath)
    if (relative === '' || relative.includes('[]')) continue

    if (targetAppField) {
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
        (f) => f.appFieldKey === targetAppField && f.appSlug === appSlug
      )
      if (matches.length === 0) continue
      const isIdentityField = matches.some((f) => f.isIdentity)
      bindings.push(
        bindSourceToAppField(
          entityDefinitionId,
          appSlug,
          targetAppField,
          rootPath,
          sourceField,
          isIdentityField ? { kind: 'externalId' } : undefined
        )
      )
      continue
    }
    if (!targetKey) continue
    const target = fieldByKey.get(targetKey) ?? fieldByKey.get(normalizeFieldKey(targetKey))
    if (!target) continue
    bindings.push(bindSourceToTarget(entityDefinitionId, rootPath, sourceField, target))
  }
  return bindings
}

/**
 * Build the `FieldMapping[]` for a contributing mapping's `connectionAppFields` —
 * plain (never identity) app fields filled from the connector's CONNECTION METADATA
 * (e.g. Shopify `shopDomain`) rather than the source record. The only synthetic
 * write channel: no source binding, so `expression`/`sourceFields` are unused and
 * `connectionMetaKey` carries the metadata key the sink reads at write time
 * (`ctx.connectionMeta`). Always the late-bound `@app:` ref — connection metadata is
 * per-connection by nature, same reasoning as `targetAppField`.
 */
export function buildContributingConnectionAppFields(
  entityDefinitionId: string,
  appSlug: string,
  connectionAppFields: { appFieldKey: string; from: string }[]
): FieldMapping[] {
  return connectionAppFields.map(({ appFieldKey, from }) => ({
    id: generateId(),
    targetFieldRef: toAppFieldRef(entityDefinitionId, appSlug, appFieldKey),
    expression: '',
    sourceFields: {},
    connectionMetaKey: from,
  }))
}

/**
 * Zero-config fallback for a contributing mapping that declared NO explicit
 * `fieldBindings` (approach B, automap-plan §5): name-match every LEAF source field
 * sitting directly under `rootPath` to a target field, binding only UNAMBIGUOUS,
 * writable hits. Lets a contributing stream land first/last/phone pre-mapped even when
 * the app author writes no `fieldBindings` boilerplate — explicit `fieldBindings`
 * always take precedence (the caller runs this only when none were declared).
 *
 * Conservative by construction:
 *   - only LEAF fields directly on the root object (relative path has no `.`/`[]`) —
 *     nested + array-element fields are skipped, same spirit as the match binder;
 *   - a target two source fields both resolve to is AMBIGUOUS and dropped (never guess);
 *   - non-writable / computed targets (`id`, `created_at`, the computed `fullName`) are
 *     skipped via {@link isWritableTarget}, so a Shopify `id` never lands on contact `id`;
 *   - emits plain (no `identityRole`) `FieldMapping`s; the external id is never bound.
 * Match-key targets are de-duped by the caller (match's `identityRole` wins). Every
 * binding stays overridable in the Map step.
 */
export function buildContributingAutoBindings(
  entityDefinitionId: string,
  rootPath: string,
  sourceFields: CatalogDataConnector['streams'][number]['fields'],
  defFields: ContributingTargetField[]
): FieldMapping[] {
  const fieldByKey = buildTargetFieldIndex(defFields)

  // Group candidates by resolved target id so a target claimed by 2+ sources is ambiguous.
  const byTarget = new Map<
    string,
    {
      source: CatalogDataConnector['streams'][number]['fields'][number]
      target: ContributingTargetField
    }[]
  >()
  for (const sourceField of sourceFields) {
    if (!isBoundaryPrefix(sourceField.sourcePath, rootPath)) continue
    const relative = relativeSourcePath(sourceField.sourcePath, rootPath)
    // Only leaf fields directly on the root object — skip nested + array-element paths.
    if (relative === '' || relative.includes('.') || relative.includes('[]')) continue
    const target = fieldByKey.get(relative) ?? fieldByKey.get(normalizeFieldKey(relative))
    if (!target || !isWritableTarget(target)) continue
    const list = byTarget.get(target.id) ?? []
    list.push({ source: sourceField, target })
    byTarget.set(target.id, list)
  }

  const bindings: FieldMapping[] = []
  for (const candidates of byTarget.values()) {
    if (candidates.length !== 1) continue // ambiguous → skip
    const { source, target } = candidates[0]!
    bindings.push(bindSourceToTarget(entityDefinitionId, rootPath, source, target))
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
 * Construct one `FieldMapping` binding a resolved source field to a resolved target,
 * computing the subtree-relative source path via {@link relativeSourcePath} (`mapRecord`
 * evaluates a rooted mapping against subtree-relative paths — for an array root,
 * against each extracted element). Pass `identityRole` to flag it a
 * secondary-identity match; omit for a plain value binding.
 */
function bindSourceToTarget(
  entityDefinitionId: string,
  rootPath: string,
  sourceField: CatalogDataConnector['streams'][number]['fields'][number],
  target: ContributingTargetField,
  identityRole?: FieldMapping['identityRole']
): FieldMapping {
  const relativePath = relativeSourcePath(sourceField.sourcePath, rootPath)
  return {
    id: generateId(),
    targetFieldRef: toResourceFieldId(entityDefinitionId, target.id),
    expression: `{${relativePath}}`,
    sourceFields: { [relativePath]: relativePath },
    ...(identityRole ? { identityRole } : {}),
  }
}

/**
 * Same as {@link bindSourceToTarget}, but for a `targetAppField` binding: the
 * target is an app-declared field named by `appFieldKey`, resolved to the
 * connection-late-bound `@app:` ref (never a concrete id — the field may be
 * connection-scoped, so resolution defers to sync time against the connector's
 * bound connection, same as owned `isExternalId` fields).
 */
function bindSourceToAppField(
  entityDefinitionId: string,
  appSlug: string,
  appFieldKey: string,
  rootPath: string,
  sourceField: CatalogDataConnector['streams'][number]['fields'][number],
  identityRole?: FieldMapping['identityRole']
): FieldMapping {
  const relativePath = relativeSourcePath(sourceField.sourcePath, rootPath)
  return {
    id: generateId(),
    targetFieldRef: toAppFieldRef(entityDefinitionId, appSlug, appFieldKey),
    expression: `{${relativePath}}`,
    sourceFields: { [relativePath]: relativePath },
    ...(identityRole ? { identityRole } : {}),
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
 * node at its `sourcePath`, so the mapping editor's badge/picker and the suggester see
 * the DECLARED type (`CURRENCY`, `SINGLE_SELECT`, …) instead of the bare JSON scalar.
 * STRUCT types additionally make the flatteners treat the node as a single typed value
 * leaf instead of an object branch — so a non-struct type is never stamped on a branch
 * node (an object, or an array of objects: a mis-declared manifest must not collapse a
 * real branch or a fan-out subtree). Mutates `schema` in place (it's freshly built by
 * the caller).
 */
export function overlayDeclaredFieldTypes(
  schema: Record<string, unknown>,
  fields: CatalogDataConnector['streams'][number]['fields']
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

/**
 * The source schema for an app catalog stream — DEFINITION-first. The declared fields
 * drive which paths exist (they are the projection contract; the `exampleRecord` is an
 * illustration, so a field missing from the example must still appear in the mapping
 * tree); the example refines scalar types/formats and adds undeclared shape. Declared
 * field types ride each leaf via {@link overlayDeclaredFieldTypes}.
 */
export function appCatalogStreamSchema(stream: CatalogDataConnector['streams'][number]): {
  sourceSchema: Record<string, unknown>
  schemaSource: 'catalog'
} {
  const sourceSchema = buildSchemaFromFieldPaths(stream.fields)
  if (stream.exampleRecord) {
    mergeExampleNode(
      sourceSchema as MutableSchemaNode,
      inferJsonSchema(stream.exampleRecord) as MutableSchemaNode
    )
  }
  overlayDeclaredFieldTypes(sourceSchema, stream.fields)
  return { sourceSchema, schemaSource: 'catalog' }
}
