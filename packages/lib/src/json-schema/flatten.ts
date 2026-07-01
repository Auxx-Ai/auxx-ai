// packages/lib/src/json-schema/flatten.ts
// Pure JSON-Schema → dotted-path flattening. Client-safe (no server deps) so both the
// server-side mapping suggester (`data-connectors/suggest-mappings`) and client UIs
// (webhook token-path pickers) share one walker. Extracted from suggest-mappings (v7).

/**
 * JSON-Schema extension keyword carrying a node's DECLARED field type (`CURRENCY`,
 * `SINGLE_SELECT`, `ADDRESS_STRUCT`, …). Stamped by the data-connector catalog overlay
 * so the badge/suggester see the declared semantic instead of the bare JSON scalar; a
 * stamped node also flattens as a single typed leaf instead of an object branch (the
 * STRUCT case — see plans/data-connectors/v6/address-struct-mapping-plan.md). Unknown
 * keywords are ignored by JSON-Schema and survive the `sourceSchema` jsonb round-trip.
 */
export const STRUCT_FIELD_TYPE_KEYWORD = 'x-auxx-fieldType'

/** A scalar source leaf extracted from a JSON schema, with its record-relative path. */
export interface SourceLeaf {
  /** Record-relative dotted path, e.g. `email` / `customer.email`. */
  path: string
  /** JSON-schema scalar type at this path (`string` / `number` / `boolean` / …). */
  jsonType: string
  /** The node's declared field type when it carries one (`CURRENCY`, `ADDRESS_STRUCT`, …). */
  fieldType?: string
}

interface JsonSchemaNode {
  type?: string | string[]
  format?: string
  properties?: Record<string, JsonSchemaNode>
  items?: JsonSchemaNode
  [STRUCT_FIELD_TYPE_KEYWORD]?: string
}

function nodeType(node: JsonSchemaNode): string {
  const t = node.type
  if (Array.isArray(t)) return t.find((x) => x !== 'null') ?? 'string'
  return t ?? 'object'
}

/** Options for {@link collectSchemaLeaves}. */
export interface CollectLeavesOptions {
  /**
   * Include arrays-of-scalars as leaves (path = the array's path, `jsonType` = the
   * element type). Off by default — the mapping suggester treats arrays as their own
   * fan-out mappings. Webhook token steering wants them ON: `scalar()` comma-joins an
   * array into a single `{token}` value (e.g. `ids=1,2,3`). Arrays-of-objects are
   * always skipped (no single scalar to read).
   */
  includeScalarArrays?: boolean
}

/**
 * Flatten a source JSON schema into scalar leaves, RECORD-relative (an array-root
 * schema descends into its element shape so paths read `email`, not `[].email` —
 * matching a root mapping's subtree). Object branches recurse with a dotted prefix;
 * array branches are skipped unless {@link CollectLeavesOptions.includeScalarArrays}.
 */
export function collectSchemaLeaves(
  schema: Record<string, unknown>,
  opts: CollectLeavesOptions = {}
): SourceLeaf[] {
  const root = schema as JsonSchemaNode
  const start = nodeType(root) === 'array' && root.items ? root.items : root
  const out: SourceLeaf[] = []
  const walk = (node: JsonSchemaNode, prefix: string) => {
    if (nodeType(node) !== 'object' || !node.properties) return
    for (const [key, child] of Object.entries(node.properties)) {
      const path = prefix ? `${prefix}.${key}` : key
      const t = nodeType(child)
      // A struct-typed node maps as ONE value — emit it as a leaf and don't descend into
      // its components (mirrors the client flatten in `use-source-paths`).
      const structType = child[STRUCT_FIELD_TYPE_KEYWORD]
      if (structType) out.push({ path, jsonType: t, fieldType: structType })
      else if (t === 'object') walk(child, path)
      else if (t === 'array') {
        // A collection of objects → its own mapping, not a field. A collection of
        // scalars can steer a comma-joined token when the caller opts in.
        if (!opts.includeScalarArrays || !child.items) continue
        const itemType = nodeType(child.items)
        if (itemType === 'object' || itemType === 'array') continue
        out.push({ path, jsonType: itemType })
      } else out.push({ path, jsonType: t })
    }
  }
  walk(start, '')
  return out
}

/** Last segment of a dotted path (`customer.email` → `email`). */
export function lastSegment(path: string): string {
  return path.split('.').pop() ?? path
}
