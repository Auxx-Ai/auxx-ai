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
    // An array-of-objects ROOT (the raw collection response): descend into its
    // element shape under `[]` so leaves read `[].title`, picked up by the root
    // mapping's `[]` rootPath. Named array PROPERTIES are handled below.
    if (t === 'array' && node.items) {
      walk(node.items, `${prefix}[]`, depth)
      return
    }
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

/**
 * The full source subtree under a mapping's `rootPath` — branches AND leaves,
 * returned RELATIVE to the subtree, with `depth` recomputed for relative
 * rendering (dot-nesting level; `[]` array hops don't add a level). This is the
 * hierarchy the mapping editor renders so a target field can be applied to each
 * source node. Pairs with {@link leafPathsUnder} (which returns leaves only).
 */
export function subtreeUnder(paths: SourcePath[], rootPath: string): SourcePath[] {
  // An array ROOT (`[]`) collapses `base` to '' just like the object root (''),
  // but its paths still carry a leading `[].` that must be stripped — otherwise
  // node paths (and any fan-out rootPath / leaf expression derived from them)
  // stay payload-absolute (`[].draft`, `{[].id}`) and break the relative-path
  // runtime contract. Mirror {@link leafPathsUnder} exactly.
  const isArrayRoot = rootPath.endsWith('[]') && rootPath.replace(/\[\]$/, '') === ''
  const base = rootPath.replace(/\[\]$/, '')
  const out: SourcePath[] = []
  for (const p of paths) {
    let rel: string | null = null
    if (isArrayRoot) {
      if (p.path.startsWith('[].')) rel = p.path.slice(3)
    } else if (!base) {
      rel = p.path
    } else if (p.path.startsWith(`${base}[].`)) {
      rel = p.path.slice(base.length + 3)
    } else if (p.path.startsWith(`${base}.`)) {
      rel = p.path.slice(base.length + 1)
    }
    if (rel === null || rel === '') continue
    out.push({ ...p, path: rel, depth: (rel.match(/\./g) ?? []).length })
  }
  return out
}

/** A mapping shaped enough to walk its parent chain for {@link absolutePrefix}. */
interface MappingChainNode {
  rootPath: string
  parentMappingId: string | null
}

/**
 * Join non-empty path segments into one payload-absolute path. Array segments
 * keep their `[]` suffix, so `['[]', 'line_items[]'] → '[].line_items[]'` and
 * `['orders[]', 'line_items[]'] → 'orders[].line_items[]'`. The dotted form is
 * exactly what {@link subtreeUnder}/{@link leafPathsUnder} slice against.
 */
export function joinPaths(parts: string[]): string {
  return parts.filter(Boolean).join('.')
}

/**
 * The payload-absolute path prefix of a mapping — its own `rootPath` prepended
 * with every ancestor `rootPath` (root → … → parent). `sourcePaths` from
 * {@link flattenSourceSchema} are payload-absolute, but a child mapping's stored
 * `rootPath` is parent-subtree-relative (the runtime descends one subtree per
 * level — `extractSubtrees(parentSubtree, child.rootPath)`). Slicing the right
 * subtree for a nested mapping therefore needs the FULL prefix, not the bare
 * `rootPath`. Feed the result to {@link subtreeUnder}/{@link leafPathsUnder}; the
 * relative paths they return match what gets stored in `fieldMappings` /
 * `identityStrategy.connectorFieldKey`.
 */
export function absolutePrefix<T extends MappingChainNode>(
  mapping: T,
  byId: Map<string, T>
): string {
  const parts: string[] = []
  let cur: T | undefined = mapping
  const seen = new Set<string>()
  while (cur) {
    if (cur.rootPath) parts.unshift(cur.rootPath)
    const parentId = cur.parentMappingId
    if (!parentId || seen.has(parentId)) break
    seen.add(parentId)
    cur = byId.get(parentId)
  }
  return joinPaths(parts)
}

/** Last path segment, for the indented hierarchy label (`customer.email` → `email`). */
export function lastSegment(path: string): string {
  const noArray = path.replace(/\[\]$/, '')
  const seg = noArray.split('.').pop() ?? noArray
  return path.endsWith('[]') ? `${seg}[]` : seg
}

/** Parent path of a relative source path (`tags[].name` → `tags`, `a.b` → `a`). */
function parentPath(path: string): string | null {
  const idx = path.lastIndexOf('.')
  if (idx === -1) return null
  return path.slice(0, idx).replace(/\[\]$/, '')
}

/** A source node with its nested children — the shape the mapping tree renders. */
export interface SourceTreeNode extends SourcePath {
  children: SourceTreeNode[]
}

/**
 * Nest the flat {@link subtreeUnder} paths into a real parent→child tree (objects
 * and arrays hold their fields), so the editor can render an expandable hierarchy
 * instead of a flat, manually-indented list. Input is assumed depth-first
 * (parents before children), as {@link flattenSourceSchema} emits.
 */
export function buildSourceTree(nodes: SourcePath[]): SourceTreeNode[] {
  const byPath = new Map<string, SourceTreeNode>()
  for (const n of nodes) byPath.set(n.path, { ...n, children: [] })
  const roots: SourceTreeNode[] = []
  for (const n of nodes) {
    const node = byPath.get(n.path)
    if (!node) continue
    const pp = parentPath(n.path)
    const parent = pp ? byPath.get(pp) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/**
 * Where the records live in the payload, derived from the source schema — the
 * valid `rootPath` choices for the root mapping. The base choice is dictated by
 * the root type (array → `[]` fan-out; object → `''` single record) and is NOT a
 * free choice. The only ambiguity is an envelope object that *contains* a
 * collection (`{ orders: [...] }`): there both `''` (one record) and `orders[]`
 * (fan out) are valid, so both are offered. Mirrors the runtime's
 * `extractSubtrees`. A single-element result means "no choice — just resolve it".
 */
export function rootPathCandidates(paths: SourcePath[]): string[] {
  const rootIsArray = paths.some((p) => p.path.startsWith('[]'))
  const out = new Set<string>([rootIsArray ? '[]' : ''])
  // Nested array branches (only a real alternative for an object root envelope).
  for (const p of paths) {
    if (p.isBranch && p.type === 'array') out.add(`${p.path}[]`)
  }
  return [...out]
}
