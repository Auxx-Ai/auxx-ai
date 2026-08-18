// packages/lib/src/workflow-engine/catalog/app-manifests.ts
//
// SERVER-ONLY. Imports the org cache (which pulls in bullmq) — must never be
// re-exported from `../client.ts` or the `workflow-engine` index barrel. Import
// it by relative path within lib, or by its own leaf subpath from an app. Same
// rule `catalog/resolve-outputs` and `catalog/derive-trigger-server` follow.
//
// What an app workflow block produces, resolved server-side. The canvas answers
// this by executing the block's `computeOutputs` inside the app's iframe; a
// server-side agent has no iframe, so it reads the contract of the tool the
// block's `toolMap` dispatches to instead. See
// plans/kopilot/workflow/17-app-block-authoring-and-connections.md §2.3/D3.

import { getCachedInstalledApps } from '../../cache'
import type { CachedWorkflowBlock } from '../../cache/org-cache-keys'
import { BaseType } from '../core/types'
import type { UnifiedVariable } from '../types/unified-variable'
import { schemaToUnifiedVariable } from './schema-to-variable'
import { createUnifiedOutputVariable } from './variable-conversion'

/** An app-block node type — `${appId}:${blockId}`, as persisted in `node.data.type`. */
export type AppBlockType = string

/** `${appId}:${blockId}` → the installed block, for every app installed in the org. */
export type AppBlockLookup = ReadonlyMap<AppBlockType, CachedWorkflowBlock>

/**
 * Why a resolution produced the variables it did. Callers that only need
 * variables ignore this; the authoring layer (PR B1's synthesized `validate`)
 * turns the non-`resolved` cases into actionable issues, which is the whole
 * reason they are distinguished rather than all collapsing to an empty array.
 */
export type AppBlockOutputStatus =
  /** The dispatched tool declares named outputs, and here they are. */
  | 'resolved'
  /** Resolved from a real run's `inferredSchema` rather than a declaration. */
  | 'inferred'
  /** No `resource`/`operation` picked yet — a legitimate half-configured draft. */
  | 'no-operation-selected'
  /** An operation is set but no `toolMap` entry matches it (app upgrade drift). */
  | 'unknown-operation'
  /**
   * The op resolves, but its tool declares an OPEN output object (a `z.record`
   * with no named properties) and the node has never run. The shape is
   * **unknown**, NOT empty — 190 of 261 published ops are in this state, so
   * treating it as "produces nothing" would be wrong for most of the fleet.
   */
  | 'undeclared'

export interface AppBlockOutputs {
  variables: UnifiedVariable[]
  status: AppBlockOutputStatus
}

/**
 * Build the `${appId}:${blockId}` → block lookup for one org.
 *
 * Rides the `installedApps` org cache, so it inherits that key's invalidation
 * (`app.installed` / `app.uninstalled` / `app.deployment.changed` / …) with no
 * new wiring. Uninstalled apps are already filtered out by the provider, so a
 * node left behind by an uninstall simply does not resolve — see §11.
 */
export async function buildAppBlockLookup(orgId: string): Promise<AppBlockLookup> {
  const apps = await getCachedInstalledApps(orgId)
  const byType = new Map<AppBlockType, CachedWorkflowBlock>()
  for (const inst of apps) {
    for (const block of inst.workflowBlocks ?? []) {
      byType.set(`${inst.app.id}:${block.id}`, block)
    }
  }
  return byType
}

/**
 * SDK field type → `BaseType`. The SDK's vocabulary is wider than JSON Schema's
 * (`currency`, `datetime`, `struct`, `select`, …) and most names already match a
 * `BaseType` value, so identity carries the common cases and this table covers
 * the rest. Unknown ⇒ `ANY`, never a silent `STRING` — a wrong concrete type is
 * worse for a variable picker than an honest "unknown".
 */
const SDK_TYPE_TO_BASE: Readonly<Record<string, BaseType>> = {
  struct: BaseType.OBJECT,
  object: BaseType.OBJECT,
  select: BaseType.ENUM,
  integer: BaseType.NUMBER,
  text: BaseType.STRING,
  textarea: BaseType.STRING,
}

const BASE_TYPE_VALUES = new Set<string>(Object.values(BaseType))

function sdkTypeToBaseType(type: unknown): BaseType {
  if (typeof type !== 'string') return BaseType.ANY
  const mapped = SDK_TYPE_TO_BASE[type]
  if (mapped) return mapped
  return BASE_TYPE_VALUES.has(type) ? (type as BaseType) : BaseType.ANY
}

/** One SDK field node (`toJSON()` output) → a `UnifiedVariable` at `basePath`. */
function fieldNodeToUnifiedVariable(
  node: Record<string, unknown> | undefined,
  nodeId: string,
  basePath: string
): UnifiedVariable {
  const metadata = (node?._metadata ?? {}) as Record<string, unknown>
  const variable = createUnifiedOutputVariable({
    nodeId,
    path: basePath,
    type: sdkTypeToBaseType(node?.type),
    ...(typeof metadata.label === 'string' ? { label: metadata.label } : {}),
    ...(typeof metadata.description === 'string' ? { description: metadata.description } : {}),
    ...(Array.isArray(metadata.options)
      ? { enum: metadata.options.filter((o): o is string | number => typeof o !== 'object') }
      : {}),
  })

  // Arrays nest under `items`, structs under `fields` — NOT JSON Schema's
  // `items`/`properties`. Same two keys the canvas's `catalogFieldToBlockField`
  // walks, so both sides descend identically.
  if (node?.type === 'array' && node.items) {
    variable.items = fieldNodeToUnifiedVariable(
      node.items as Record<string, unknown>,
      nodeId,
      `${basePath}[*]`
    )
  }
  const fields = node?.fields as Record<string, unknown> | undefined
  if ((node?.type === 'struct' || node?.type === 'object') && fields) {
    variable.properties = {}
    for (const [key, child] of Object.entries(fields)) {
      variable.properties[key] = fieldNodeToUnifiedVariable(
        child as Record<string, unknown>,
        nodeId,
        `${basePath}.${key}`
      )
    }
  }

  return variable
}

/**
 * A `{ fieldName: fieldNodeJSON }` map → one `UnifiedVariable` per entry.
 *
 * This is the shape `CatalogBlock.opOutputsJsonSchema` and `inputsJsonSchema`
 * carry — the SDK field `toJSON()` shape, NOT a JSON Schema. The distinction
 * matters: a JSON-Schema reader looking for `properties` finds nothing here and
 * silently returns an empty set, which is precisely the bug this whole plan
 * exists to fix. {@link schemaPropertiesToUnifiedVariables} is the other one.
 */
export function fieldNodeMapToUnifiedVariables(
  map: Record<string, unknown> | undefined,
  nodeId: string
): UnifiedVariable[] {
  if (!map || typeof map !== 'object') return []
  return Object.entries(map).map(([name, node]) =>
    fieldNodeToUnifiedVariable(node as Record<string, unknown>, nodeId, name)
  )
}

/**
 * Top-level JSON-Schema properties → one `UnifiedVariable` per property.
 *
 * Deliberately NOT `schemaRootToUnifiedVariables`, which wraps the whole schema
 * in a single `structured_output` variable. App blocks are flat: the engine
 * writes every top-level key of the tool result as its own node variable
 * (`app-workflow-block-processor.ts` → `setNodeVariable(nodeId, fieldName, …)`),
 * so a ref is `{{Node.trackingNumber}}`, never
 * `{{Node.structured_output.trackingNumber}}`. This mirrors the canvas's
 * `schemaRootToWorkflowFields`, which flattens the same way.
 *
 * Getting this wrong would be worse than resolving nothing: ref-checking
 * validates against the resolved set, so a wrongly-shaped set would *approve*
 * refs the engine can never resolve.
 */
export function schemaPropertiesToUnifiedVariables(
  schema: unknown,
  nodeId: string
): UnifiedVariable[] {
  const properties = (schema as { properties?: Record<string, unknown> } | null)?.properties
  if (!properties) return []
  return Object.entries(properties).map(([key, propSchema]) =>
    schemaToUnifiedVariable(propSchema, nodeId, key)
  )
}

/**
 * Resolve one app-block node's outputs, on a three-rung ladder:
 *
 *  1. `node.data.inferredSchema` — what a real run actually returned. Wins,
 *     because a declaration is only a subset guarantee (the engine's permissive
 *     mode passes undeclared keys straight through).
 *  2a. `block.opOutputsJsonSchema[resource.operation]` — the block's own
 *     `computeOutputs`, evaluated per op at publish time. Preferred, because it
 *     is the block's own answer AND the same one the canvas renders, so agent
 *     and canvas agree by construction.
 *  2b. The dispatched op's tool outputs, via `toolMap`. Fallback for catalogs
 *     published before 2a existed — 71 of 261 ops have these.
 *  3. The block's own `schema.outputs` — op-independent, and `{}` on every
 *     published block today. Here for the non-router block that declares its
 *     shape once, and so that A1's projection of this field is not dead data.
 *
 * Rungs 1 and 2 merge when both exist; the same precedence as the canvas's
 * `resolve-app-outputs.ts`.
 */
export function resolveAppBlockOutputs(
  block: CachedWorkflowBlock,
  data: Record<string, unknown> | undefined,
  nodeId: string
): AppBlockOutputs {
  const inferred = schemaPropertiesToUnifiedVariables(data?.inferredSchema, nodeId)

  const resource = typeof data?.resource === 'string' ? data.resource : undefined
  const operation = typeof data?.operation === 'string' ? data.operation : undefined

  // Why the op is missing, when it is — kept so the caller can say something
  // useful ("pick an operation" vs "that operation no longer exists") instead
  // of handing back a bare empty set, which is the §1 bug.
  let unresolvedOp: Extract<
    AppBlockOutputStatus,
    'no-operation-selected' | 'unknown-operation'
  > | null = null
  let opDeclared: UnifiedVariable[] = []

  if (!resource || !operation) {
    unresolvedOp = 'no-operation-selected'
  } else {
    const key = `${resource}.${operation}`
    const op = block.ops.find((o) => o.key === key)
    if (!op) {
      unresolvedOp = 'unknown-operation'
    } else {
      // 2a then 2b. Note the two carry DIFFERENT shapes — a field-node map vs a
      // JSON Schema — hence two converters. Reading either with the other's
      // reader yields a silent empty set.
      const computed = fieldNodeMapToUnifiedVariables(block.opOutputsJsonSchema?.[key], nodeId)
      opDeclared =
        computed.length > 0
          ? computed
          : schemaPropertiesToUnifiedVariables(op.outputsJsonSchema, nodeId)
    }
  }

  const declared =
    opDeclared.length > 0
      ? opDeclared
      : schemaPropertiesToUnifiedVariables(block.outputsJsonSchema, nodeId)

  if (inferred.length > 0) {
    return {
      variables: declared.length > 0 ? mergeById(declared, inferred) : inferred,
      status: 'inferred',
    }
  }
  if (declared.length > 0) return { variables: declared, status: 'resolved' }
  return { variables: [], status: unresolvedOp ?? 'undeclared' }
}

/**
 * Declared variables in declared order, each replaced by its inferred
 * counterpart where one exists, then any inferred-only variables appended.
 */
function mergeById(declared: UnifiedVariable[], inferred: UnifiedVariable[]): UnifiedVariable[] {
  const inferredById = new Map(inferred.map((v) => [v.id, v]))
  const merged = declared.map((v) => inferredById.get(v.id) ?? v)
  const declaredIds = new Set(declared.map((v) => v.id))
  for (const v of inferred) {
    if (!declaredIds.has(v.id)) merged.push(v)
  }
  return merged
}
