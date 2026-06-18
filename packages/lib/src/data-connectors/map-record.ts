// packages/lib/src/data-connectors/map-record.ts
// Mapping layer (04 §1a). Turns one source-shaped ConnectorRecord into N
// projected writes — one per DataConnectorMapping of the stream — by extracting
// the mapping's rootPath subtree and evaluating its CALC field mappings. Handles
// linkMode (upsert writes / reference registers a pending relation on the parent)
// and wires embedded relationships as pending relations on the parent's item.

import { evaluateCalcExpression } from '@auxx/utils/calc-expression'
import type { ConnectorRecord } from './connectors/types'
import type { DecodedMapping } from './service'
import type { ProjectedRecord } from './sinks/types'

/** One mapping's projection result for a single source record. */
export interface MappedWrite {
  mapping: DecodedMapping
  /** Present for `upsert` mappings — the record to write. Null for `reference`. */
  projected: ProjectedRecord | null
  /**
   * Relation this mapping contributes to its PARENT (embedded upsert child or
   * id-only reference). Null for the root mapping. The orchestrator stamps it
   * onto the parent's item after the parent record is written.
   */
  parentRelation: {
    parentMappingId: string
    fieldKey: string
    targetMappingId: string
    targetExternalId: string
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
  source: Record<string, unknown>,
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
 * Evaluate one mapping's CALC field expressions against a subtree. A one-click
 * row is the bare `{source}` token — `sourceFields` maps each placeholder to the
 * subtree-relative source path. The placeholder context is built from the
 * mapping's declared source fields so the CALC evaluator resolves `{...}` refs.
 */
function evaluateFields(mapping: DecodedMapping, subtree: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const subtreeObj =
    subtree && typeof subtree === 'object' ? (subtree as Record<string, unknown>) : null

  for (const [targetFieldKey, fm] of Object.entries(mapping.fieldMappings)) {
    // Build the placeholder → value context for this expression.
    const ctx: Record<string, unknown> = {}
    for (const [placeholder, sourcePath] of Object.entries(fm.sourceFields ?? {})) {
      ctx[placeholder] =
        subtreeObj && !sourcePath.includes('.') && !sourcePath.includes('[')
          ? subtreeObj[sourcePath]
          : getByPath(subtree, sourcePath)
    }
    // Degenerate one-click case: an id-only subtree (e.g. a scalar) with a single
    // {source} token mapping to the whole subtree.
    if (Object.keys(ctx).length === 0 && fm.expression.trim() === '{source}') {
      out[targetFieldKey] = subtree
      continue
    }
    out[targetFieldKey] = evaluateCalcExpression(fm.expression, ctx)
  }
  return out
}

/**
 * Resolve a mapping's identity match values from the source subtree. matchField/
 * composite read a subtree-relative source path (`connectorFieldKey`) and pair it
 * with the target field it must equal; the sink normalizes + looks up. Other
 * strategies (connectorExternalId / manualReview) contribute no candidates.
 */
function identityCandidates(
  mapping: DecodedMapping,
  subtree: unknown
): ProjectedRecord['identityCandidates'] {
  const strategy = mapping.identityStrategy
  const rules =
    strategy.kind === 'matchField'
      ? [
          {
            connectorFieldKey: strategy.connectorFieldKey,
            targetFieldId: strategy.targetFieldId,
            normalize: strategy.normalize,
          },
        ]
      : strategy.kind === 'composite'
        ? strategy.rules
        : []
  return rules.map((r) => ({
    targetFieldId: r.targetFieldId,
    value: getByPath(subtree, r.connectorFieldKey),
    normalize: r.normalize,
  }))
}

/** Derive the external id of a subtree (its own id, falling back to index). */
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
 * Map one source record across all of a stream's mappings (the fan-out).
 *
 * The ROOT mapping (rootPath '') is always first in the returned list so the
 * orchestrator can write it and learn its externalId before stamping child
 * relations. Child mappings carry a `parentRelation` describing the edge to wire.
 */
export function mapRecord(mappings: DecodedMapping[], source: ConnectorRecord): MappedWrite[] {
  const writes: MappedWrite[] = []
  // Root externalId is the connector record's externalId.
  const rootExternalId = source.externalId

  // Sort so root (no parent) comes first, then children.
  const ordered = [...mappings].sort((a, b) => {
    if (!a.parentMappingId && b.parentMappingId) return -1
    if (a.parentMappingId && !b.parentMappingId) return 1
    return 0
  })

  for (const mapping of ordered) {
    const subtrees = extractSubtrees(source.fields, mapping.rootPath)

    for (const { value: subtree, index } of subtrees) {
      if (subtree === undefined || subtree === null) continue

      const externalId =
        mapping.rootPath === '' ? rootExternalId : subtreeExternalId(rootExternalId, subtree, index)

      const parentRelation =
        mapping.parentMappingId && mapping.relationshipFieldKey
          ? {
              parentMappingId: mapping.parentMappingId,
              fieldKey: mapping.relationshipFieldKey,
              targetMappingId: mapping.row.id,
              targetExternalId: externalId,
            }
          : null

      if (mapping.linkMode === 'reference') {
        // Reference: no write — just register the pending relation on the parent.
        writes.push({ mapping, projected: null, parentRelation })
        continue
      }

      const fields = evaluateFields(mapping, subtree)
      const displayName =
        mapping.rootPath === ''
          ? source.displayName
          : subtreeDisplayName(subtree, source.displayName)

      writes.push({
        mapping,
        projected: {
          externalId,
          displayName,
          fields,
          identityCandidates: identityCandidates(mapping, subtree),
          pendingRelations: [],
        },
        parentRelation,
      })
    }
  }

  return writes
}
