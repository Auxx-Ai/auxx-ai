// apps/web/src/components/data-connectors/hooks/use-source-paths.ts
'use client'

import { useMemo } from 'react'

/** A leaf/branch path in the source (Layer A) schema, for the inline pickers. */
export interface SourcePath {
  /** Dotted path, e.g. `customer.email`, `line_items[].sku`. */
  path: string
  /** JSON-schema type at this path (`string` / `number` / `object` / `array`). */
  type: string
  /** Depth (for indenting the picker list). */
  depth: number
  /** True for object/array branches (not directly mappable as a value). */
  isBranch: boolean
}

interface JsonSchemaNode {
  type?: string | string[]
  properties?: Record<string, JsonSchemaNode>
  items?: JsonSchemaNode
}

function typeOf(node: JsonSchemaNode): string {
  const t = node.type
  if (Array.isArray(t)) return t.find((x) => x !== 'null') ?? 'string'
  return t ?? 'object'
}

/**
 * Flatten a JSON-schema source shape (Layer A) into selectable paths. Arrays of
 * objects expand under `path[]`. Used by the value-row source pickers + the
 * mapping seeding. Subtree paths can be filtered by `rootPath`.
 */
export function flattenSourceSchema(
  schema: Record<string, unknown> | null | undefined
): SourcePath[] {
  if (!schema || typeof schema !== 'object') return []
  const out: SourcePath[] = []

  const walk = (node: JsonSchemaNode, prefix: string, depth: number) => {
    const t = typeOf(node)
    if (t === 'object' && node.properties) {
      for (const [key, child] of Object.entries(node.properties)) {
        const childPath = prefix ? `${prefix}.${key}` : key
        const childType = typeOf(child)
        const isBranch =
          childType === 'object' || (childType === 'array' && !!child.items?.properties)
        out.push({ path: childPath, type: childType, depth, isBranch })
        if (childType === 'object') {
          walk(child, childPath, depth + 1)
        } else if (childType === 'array' && child.items) {
          walk(child.items, `${childPath}[]`, depth + 1)
        }
      }
    }
  }

  walk(schema as JsonSchemaNode, '', 0)
  return out
}

/** React hook wrapper (memoized) over {@link flattenSourceSchema}. */
export function useSourcePaths(schema: Record<string, unknown> | null | undefined): SourcePath[] {
  return useMemo(() => flattenSourceSchema(schema), [schema])
}

/**
 * Leaf (value) paths under a mapping's `rootPath`, returned RELATIVE to that
 * subtree. This matches the sync runtime, which descends into the subtree
 * (`extractSubtrees(source.fields, rootPath)`) before resolving each field path
 * (`getByPath(subtree, relativePath)`) — so a `line_items[]` mapping references
 * `price`, not `line_items[].price`. The root mapping (`''`) returns its leaves
 * unchanged (relative == absolute).
 */
export function leafPathsUnder(paths: SourcePath[], rootPath: string): SourcePath[] {
  if (!rootPath) return paths.filter((p) => !p.isBranch)
  const base = rootPath.replace(/\[\]$/, '')
  const out: SourcePath[] = []
  for (const p of paths) {
    if (p.isBranch) continue
    let rel: string | null = null
    if (p.path.startsWith(`${base}[].`)) rel = p.path.slice(base.length + 3)
    else if (p.path.startsWith(`${base}.`)) rel = p.path.slice(base.length + 1)
    if (rel) out.push({ ...p, path: rel })
  }
  return out
}
