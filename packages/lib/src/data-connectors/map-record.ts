// packages/lib/src/data-connectors/map-record.ts
// Mapping layer (04 §1a). Turns one raw connector payload into N projected
// writes by walking the mapping TREE: the root mapping extracts its rootPath
// subtree(s) out of the payload (e.g. `[]` / `data.orders[]`), and each child
// mapping extracts RELATIVE to its parent's subtree (so `orders[]` → `line_items[]`
// nests). Each subtree instance evaluates its CALC field mappings. Handles
// linkMode (upsert writes / reference registers a pending relation on the parent)
// and wires embedded relationships as pending relations on the parent's item.

import { evaluateCalcExpression } from '@auxx/utils/calc-expression'
import type { ConnectorRecord } from './connectors/types'
import type { DecodedMapping } from './service'
import type { ProjectedRecord } from './sinks/types'
import type { FieldMapping } from './types'
import { parseUpstreamUpdatedAt } from './watermark'

/** One mapping's projection result for a single source record. */
export interface MappedWrite {
  mapping: DecodedMapping
  /** Present for `upsert` mappings — the record to write. Null for `reference`. */
  projected: ProjectedRecord | null
  /**
   * The drilled relationship edge this mapping contributes (embedded upsert child or
   * id-only reference). Null for the root mapping. Cardinality-NEUTRAL — map-record
   * is a pure function with no field cache, so it emits the raw intent (the authored
   * `relationshipRef` + both ends' mappings/ids/defs) and the orchestrator
   * (`sink-source-record`) resolves cardinality against the cache: a belongs_to edge
   * stamps onto the PARENT instance, a has_many edge side-flips onto each CHILD via
   * the inverse key (relationship-linking v3 §9.6 step 6).
   */
  parentRelation: {
    parentMappingId: string
    parentExternalId: string
    /** This mapping (the child / reference branch). */
    childMappingId: string
    /** The child instance's external id. Null for a CLEAR (FK went empty). */
    childExternalId: string | null
    /** The authored relationship edge, serialized `FieldReference` (`fieldRefToKey`). */
    relationshipRef: string
    /** This (child / reference) mapping's own target def — the belongs_to target def. */
    relatedDef: string
  } | null
}

/** Walk a dotted path into a value. '' / undefined → the whole record. */
function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/**
 * Extract the subtree(s) a mapping's rootPath addresses.
 * - `''` → the whole record (one subtree).
 * - `customer` → the embedded object (one subtree).
 * - `line_items[]` → each array element (one subtree per element).
 * - `line_items[].product_id` → each element's `product_id` (one per element).
 *
 * Returns an array of `{ value, index }` where `index` disambiguates array
 * elements for external-id derivation.
 */
function extractSubtrees(
  source: unknown,
  rootPath: string
): Array<{ value: unknown; index: number | null }> {
  if (!rootPath) return [{ value: source, index: null }]

  const arrayMatch = rootPath.indexOf('[]')
  if (arrayMatch === -1) {
    return [{ value: getByPath(source, rootPath), index: null }]
  }

  const before = rootPath.slice(0, arrayMatch)
  const after = rootPath.slice(arrayMatch + 2).replace(/^\./, '')
  const arr = getByPath(source, before)
  if (!Array.isArray(arr)) return []
  return arr.map((el, index) => ({
    value: after ? getByPath(el, after) : el,
    index,
  }))
}

/**
 * Evaluate one binding entry's CALC expression against a subtree. A one-click row
 * is the bare `{source}` token — `sourceFields` maps each placeholder to the
 * subtree-relative source path. The placeholder context is built from the entry's
 * declared source fields so the CALC evaluator resolves `{...}` refs. Used both for
 * projecting target fields AND for reading a designated External-ID value (which may
 * itself be a CALC composite — `{sku}-{variant}`, §9.4).
 */
function evaluateFieldValue(fm: FieldMapping, subtree: unknown): unknown {
  const subtreeObj =
    subtree && typeof subtree === 'object' ? (subtree as Record<string, unknown>) : null
  const ctx: Record<string, unknown> = {}
  for (const [placeholder, sourcePath] of Object.entries(fm.sourceFields ?? {})) {
    ctx[placeholder] =
      subtreeObj && !sourcePath.includes('.') && !sourcePath.includes('[')
        ? subtreeObj[sourcePath]
        : getByPath(subtree, sourcePath)
  }
  // Degenerate one-click case: an id-only subtree (e.g. a scalar) with a single
  // {source} token mapping to the whole subtree.
  if (Object.keys(ctx).length === 0 && fm.expression.trim() === '{source}') return subtree
  return evaluateCalcExpression(fm.expression, ctx)
}

/**
 * Evaluate one mapping's CALC field expressions against a subtree, keyed by each
 * binding's `targetFieldRef`. Unassigned drafts (no target) are skipped.
 */
function evaluateFields(mapping: DecodedMapping, subtree: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const fm of mapping.fieldMappings) {
    if (fm.targetFieldRef == null) continue // unassigned draft — projected nowhere
    // connectionMetaKey bindings read connection metadata, not the source subtree —
    // the sink injects their value before the write set is built (entity-sink.ts).
    if (fm.connectionMetaKey != null) continue
    out[fm.targetFieldRef] = evaluateFieldValue(fm, subtree)
  }
  return out
}

/**
 * Resolve a mapping's secondary identity-match values from the source subtree.
 * Every bound field whose `identityRole.kind === 'match'` is a secondary identity
 * key (the external id is always the primary): evaluate its binding's CALC value —
 * the same `evaluateFieldValue` used for projection + the External ID, so a FORMULA
 * match key (`concat({store},{order_no})`) works, and a bare token still resolves to
 * its single source value — and pair it with the target field key it must equal; the
 * sink normalizes + looks up. No flagged fields → no candidates → the record creates
 * / re-identifies by external id.
 */
function identityCandidates(
  mapping: DecodedMapping,
  subtree: unknown
): ProjectedRecord['identityCandidates'] {
  const candidates: ProjectedRecord['identityCandidates'] = []
  for (const fm of mapping.fieldMappings) {
    if (fm.identityRole?.kind !== 'match' || fm.targetFieldRef == null) continue
    candidates.push({
      targetFieldRef: fm.targetFieldRef,
      value: evaluateFieldValue(fm, subtree),
      normalize: fm.identityRole.normalize,
    })
  }
  return candidates
}

/**
 * The explicit, user-designated external id of a subtree (relationship-linking v3
 * §9.3a) — the ordered `externalId`-role chain, first non-null wins (`id → email`).
 * Each entry's value is the CALC result of its expression, so a composite key
 * (`{sku}-{variant}`) works with no new mechanism. Returns null when nothing is
 * designated (or every designated source is blank) → the caller falls back to the
 * heuristic guess. This replaces the silent `subtreeExternalId` guess as the
 * PRIMARY anchor.
 */
function designatedExternalId(mapping: DecodedMapping, subtree: unknown): string | null {
  const entries = mapping.fieldMappings
    .filter((fm) => fm.identityRole?.kind === 'externalId')
    .sort((a, b) => extOrder(a) - extOrder(b))
  for (const fm of entries) {
    const v = evaluateFieldValue(fm, subtree)
    // An External ID must be a scalar the runtime can stringify into a stable key.
    // Skip objects/arrays — e.g. a `{source}` anchor accidentally evaluated against a
    // whole object subtree would otherwise `String()` to '[object Object]' and collapse
    // every record onto one external id (§9.4 is coercible-scalars only).
    if (v == null || v === '' || typeof v === 'object') continue
    return String(v)
  }
  return null
}

/** The fallback `order` of an `externalId`-role entry (absent ⇒ 0 = primary). */
function extOrder(fm: FieldMapping): number {
  return fm.identityRole?.kind === 'externalId' ? (fm.identityRole.order ?? 0) : 0
}

/**
 * Heuristic external id of a subtree (its own id, falling back to a synthetic
 * index). Used only when nothing is explicitly designated as External ID — the
 * editor pre-fills the designation from this same heuristic, so the common case
 * stays zero-click while a wrong guess is now visible + overridable (§9.4).
 */
function subtreeExternalId(
  parentExternalId: string,
  subtree: unknown,
  index: number | null
): string {
  if (subtree && typeof subtree === 'object') {
    const obj = subtree as Record<string, unknown>
    const id = obj.id ?? obj.externalId ?? obj._id ?? obj.uuid ?? obj.key
    if (id !== undefined && id !== null) return String(id)
  }
  if (typeof subtree === 'string' || typeof subtree === 'number') return String(subtree)
  // Synthetic id for index-addressed embedded children with no natural id.
  return index === null ? parentExternalId : `${parentExternalId}:${index}`
}

/** Derive a display name for a projected subtree. */
function subtreeDisplayName(subtree: unknown, fallback: string): string {
  if (subtree && typeof subtree === 'object') {
    const obj = subtree as Record<string, unknown>
    const name = obj.name ?? obj.title ?? obj.displayName
    if (typeof name === 'string' && name.length > 0) return name
  }
  return fallback
}

/**
 * The external id of a subtree (relationship-linking v3 §9.6 step 1). Precedence:
 *   1. the explicit, user-designated External-ID chain (`designatedExternalId`) —
 *      the anchor that fixes §3.2's silent mis-targeting;
 *   2. the connector-provided hint for a whole-record root mapping;
 *   3. the heuristic guess (`id`/`externalId`/… else synthetic `parent:index`).
 */
function resolveExternalId(
  mapping: DecodedMapping,
  subtree: unknown,
  index: number | null,
  parentExternalId: string | null,
  rootHintId: string
): string {
  const designated = designatedExternalId(mapping, subtree)
  if (designated != null) return designated
  if (mapping.rootPath === '' && parentExternalId === null && rootHintId) return rootHintId
  return subtreeExternalId(parentExternalId ?? rootHintId, subtree, index)
}

/** The display name of a subtree (connector hint for a whole-record root, else derived). */
function resolveDisplayName(
  mapping: DecodedMapping,
  subtree: unknown,
  parentExternalId: string | null,
  rootHintName: string
): string {
  if (mapping.rootPath === '' && parentExternalId === null && rootHintName) return rootHintName
  return subtreeDisplayName(subtree, rootHintName)
}

/**
 * Map one raw connector payload across a stream's mapping tree (the fan-out).
 *
 * Walks parent→child: each root mapping extracts its subtree(s) from the payload,
 * then recurses into child mappings relative to each parent subtree. A parent
 * write is always pushed before its children, so the orchestrator writes it and
 * learns its externalId before stamping child relations. Child mappings carry a
 * `parentRelation` (with the parent INSTANCE's externalId) describing the edge.
 */
export function mapRecord(
  mappings: DecodedMapping[],
  source: ConnectorRecord,
  /**
   * Subtree-relative dotted path to each ROOT record's upstream last-modified
   * (the stream's `incremental.watermarkField`, e.g. `updated_at`). When given, the
   * parsed value is stamped onto each root projected record's `upstreamUpdatedAt` —
   * the durable version stamp the sink's out-of-order guard compares (sync-bridge
   * §9 Q7). Children inherit no stamp (they version with their parent event).
   */
  updatedAtPath?: string
): MappedWrite[] {
  const writes: MappedWrite[] = []

  // Connector-provided hints — used only for a whole-record (`rootPath ''`) root.
  const rootHintId = source.externalId ?? ''
  const rootHintName = source.displayName ?? ''

  // Group mappings by parent so the walk can descend the tree.
  const childrenOf = new Map<string | null, DecodedMapping[]>()
  for (const m of mappings) {
    const key = m.parentMappingId ?? null
    const list = childrenOf.get(key) ?? []
    list.push(m)
    childrenOf.set(key, list)
  }

  const walk = (mapping: DecodedMapping, parent: unknown, parentExternalId: string | null) => {
    const isReference = mapping.linkMode === 'reference'
    const linksParent =
      mapping.parentMappingId != null &&
      mapping.relationshipFieldKey != null &&
      parentExternalId !== null

    for (const { value: subtree, index } of extractSubtrees(parent, mapping.rootPath)) {
      // Empty subtree: a `reference` flat-FK clears the edge (clear-on-empty);
      // an `upsert` mapping has nothing to write, so it's skipped as before. The
      // empty-string FK only counts as empty for a reference (an upsert subtree of
      // `''` is left to today's behavior — null/undefined only).
      const isEmpty = subtree === undefined || subtree === null || (isReference && subtree === '')
      if (isEmpty) {
        if (isReference && linksParent) {
          writes.push({
            mapping,
            projected: null,
            parentRelation: {
              parentMappingId: mapping.parentMappingId!,
              parentExternalId: parentExternalId!,
              childMappingId: mapping.row.id,
              childExternalId: null, // CLEAR — FK went empty
              relationshipRef: mapping.relationshipFieldKey!,
              relatedDef: mapping.entityDefinitionId,
            },
          })
        }
        continue
      }

      const externalId = resolveExternalId(mapping, subtree, index, parentExternalId, rootHintId)

      const parentRelation = linksParent
        ? {
            parentMappingId: mapping.parentMappingId!,
            parentExternalId: parentExternalId!,
            childMappingId: mapping.row.id,
            childExternalId: externalId,
            relationshipRef: mapping.relationshipFieldKey!,
            relatedDef: mapping.entityDefinitionId,
          }
        : null

      if (mapping.linkMode === 'reference') {
        // Reference: no write — just register the pending relation on the parent.
        writes.push({ mapping, projected: null, parentRelation })
      } else {
        writes.push({
          mapping,
          projected: {
            externalId,
            displayName: resolveDisplayName(mapping, subtree, parentExternalId, rootHintName),
            fields: evaluateFields(mapping, subtree),
            identityCandidates: identityCandidates(mapping, subtree),
            pendingRelations: [],
            // Root records carry the version stamp; children version with the event.
            upstreamUpdatedAt:
              updatedAtPath && mapping.parentMappingId == null
                ? parseUpstreamUpdatedAt(getByPath(subtree, updatedAtPath))
                : undefined,
          },
          parentRelation,
        })
      }

      // Recurse into children relative to THIS subtree.
      for (const child of childrenOf.get(mapping.row.id) ?? []) {
        walk(child, subtree, externalId)
      }
    }
  }

  for (const root of childrenOf.get(null) ?? []) {
    walk(root, source.fields, null)
  }

  return writes
}
