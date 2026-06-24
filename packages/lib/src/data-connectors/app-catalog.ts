// packages/lib/src/data-connectors/app-catalog.ts
// Pure helpers for materializing an installed app's catalog data-connector into the
// setup surface (create-sync-flow §3.1, Tier 1). Kept dependency-light (no
// drizzle/bullmq) so it's unit-testable in isolation; `mutations.ts` composes these
// with the DB write helpers in `createConnectorFromAppCatalog`.

import type { CatalogDataConnector } from '@auxx/database'
import { toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { inferJsonSchema } from '../json-schema'
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
}

/**
 * Pre-bind a contributing mapping's declared identity-match keys into `FieldMapping`
 * entries flagged `match` (the secondary-identity link the sink merges on, e.g. an
 * existing contact by `email`). Pure (caller supplies `defFields`) so it's unit-testable
 * without the org cache. A key binds only when it resolves UNAMBIGUOUSLY on both sides:
 *   - source — a declared stream field whose absolute `sourcePath` is the key under
 *     the mapping's `rootPath` (`customer` + `email` → `customer.email`); the stored
 *     `sourceFields` path is subtree-relative (`email`), matching how `mapRecord`
 *     evaluates a rooted mapping;
 *   - target — a field on the contributing def keyed by that match key (its
 *     `systemAttribute`, name, or normalized name).
 * Unresolved or array-rooted keys are dropped (the row stays a `needs-mapping` draft).
 * See multi-stream-setup-plan §5.2.
 */
export function buildContributingMatchBindings(
  entityDefinitionId: string,
  rootPath: string,
  matchFieldKeys: string[],
  sourceFields: CatalogDataConnector['streams'][number]['fields'],
  defFields: ContributingTargetField[]
): FieldMapping[] {
  if (matchFieldKeys.length === 0) return []
  // Identity match lives on a nested object (e.g. `customer`); array roots have no
  // single deterministic source path for a key, so skip auto-binding them.
  if (rootPath.includes('[]')) return []

  const fieldByKey = new Map<string, ContributingTargetField>()
  for (const fld of defFields) {
    if (fld.systemAttribute) {
      fieldByKey.set(fld.systemAttribute, fld)
      fieldByKey.set(normalizeFieldKey(fld.systemAttribute), fld)
    }
    fieldByKey.set(fld.name, fld)
    fieldByKey.set(normalizeFieldKey(fld.name), fld)
  }

  const prefix = rootPath ? `${rootPath}.` : ''
  const bindings: FieldMapping[] = []
  for (const key of matchFieldKeys) {
    const target = fieldByKey.get(key) ?? fieldByKey.get(normalizeFieldKey(key))
    if (!target) continue
    const absolutePath = `${prefix}${key}`
    const sourceField = sourceFields.find((f) => f.sourcePath === absolutePath)
    if (!sourceField) continue
    // Subtree-relative path (strip the rootPath prefix the source field declares).
    const relativePath = sourceField.sourcePath.slice(prefix.length)
    bindings.push({
      id: generateId(),
      targetFieldRef: toResourceFieldId(entityDefinitionId, target.id),
      expression: `{${relativePath}}`,
      sourceFields: { [relativePath]: relativePath },
      match: { normalize: deriveNormalizeFromType(target.type) },
    })
  }
  return bindings
}

/** The source schema for an app catalog stream — prefer its canonical sample. */
export function appCatalogStreamSchema(stream: CatalogDataConnector['streams'][number]): {
  sourceSchema: Record<string, unknown>
  schemaSource: 'catalog'
} {
  const sourceSchema = stream.exampleRecord
    ? (inferJsonSchema(stream.exampleRecord) as Record<string, unknown>)
    : buildSchemaFromFieldPaths(stream.fields)
  return { sourceSchema, schemaSource: 'catalog' }
}
