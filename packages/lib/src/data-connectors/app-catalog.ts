// packages/lib/src/data-connectors/app-catalog.ts
// Pure helpers for materializing an installed app's catalog data-connector into the
// setup surface (create-sync-flow §3.1, Tier 1). Kept dependency-light (no
// drizzle/bullmq) so it's unit-testable in isolation; `mutations.ts` composes these
// with the DB write helpers in `createConnectorFromAppCatalog`.

import type { CatalogDataConnector } from '@auxx/database'
import { inferJsonSchema } from '../json-schema'

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
