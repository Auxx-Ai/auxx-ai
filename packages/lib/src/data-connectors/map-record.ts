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

/** One mapping's projection result for a single source record. */
export interface MappedWrite {
  mapping: DecodedMapping
  /** Present for `upsert` mappings — the record to write. Null for `reference`. */
  projected: ProjectedRecord | null
  /**
   * Relation this mapping contributes to its PARENT (embedded upsert child or
   * id-only reference). Null for the root mapping. The orchestrator stamps it
   * onto the parent INSTANCE's item (keyed by parentMappingId + parentExternalId)
   * after that parent record is written.
   */
  parentRelation: {
    parentMappingId: string
    parentExternalId: string
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
 * The external id of a subtree. A whole-record root mapping (`rootPath ''` at the
 * top level) may use the connector-provided hint when the subtree can't identify
 * itself; fan-out + nested subtrees always derive from the subtree itself.
 */
function resolveExternalId(
  mapping: DecodedMapping,
  subtree: unknown,
  index: number | null,
  parentExternalId: string | null,
  rootHintId: string
): string {
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
export function mapRecord(mappings: DecodedMapping[], source: ConnectorRecord): MappedWrite[] {
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
    for (const { value: subtree, index } of extractSubtrees(parent, mapping.rootPath)) {
      if (subtree === undefined || subtree === null) continue

      const externalId = resolveExternalId(mapping, subtree, index, parentExternalId, rootHintId)

      const parentRelation =
        mapping.parentMappingId && mapping.relationshipFieldKey && parentExternalId !== null
          ? {
              parentMappingId: mapping.parentMappingId,
              parentExternalId,
              fieldKey: mapping.relationshipFieldKey,
              targetMappingId: mapping.row.id,
              targetExternalId: externalId,
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
