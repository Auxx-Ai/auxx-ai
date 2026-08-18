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

import { z } from 'zod'
import { getCachedInstalledApps } from '../../cache'
import type { CachedInstalledApp, CachedWorkflowBlock } from '../../cache/org-cache-keys'
import { BaseType } from '../core/types'
import { isAppInputField } from '../nodes/utils/app-input-fields'
import type { UnifiedVariable } from '../types/unified-variable'
import { getManifest } from './registry'
import { schemaToUnifiedVariable } from './schema-to-variable'
import {
  type ManifestLookup,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from './types'
import { createUnifiedOutputVariable } from './variable-conversion'
import { extractVarIdsFromString } from './variable-inference'

/** An app-block node type — `${appId}:${blockId}`, as persisted in `node.data.type`. */
export type AppBlockType = string

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

// ---------------------------------------------------------------------------
// The synthesized manifest (PR B1)
//
// An app block gets a real `NodeManifest` built from the catalog projection,
// rather than an `if (isAppBlock(type))` branch at each of the six sites that
// currently fail differently on one (silent `[]`, silent `continue`, hard 400,
// wrong handle). Six branches would mean six independently-driftable
// semantics; one manifest means every existing consumer — `validateNodeConfigs`,
// `requireAuthorableManifest`, `resolveOutputs`, `isInputNodePair`, `run-node`
// — works unchanged. See plan 17 D1/D2.
// ---------------------------------------------------------------------------

/** An app block's persisted `node.data`: platform keys plus the block's own flat inputs. */
export type AppBlockConfig = Record<string, unknown>

/**
 * Platform-owned `node.data` keys, declared so the agent sees them in the
 * schema and so `configSchema` types the ones it may set (`connectionId`,
 * `fieldModes`, `title`). Identity keys are declared but not agent-facing —
 * `add_node` stamps them from `defaultData`.
 *
 * Deliberately NOT exhaustive: the schema is `.passthrough()`, because an app
 * block's input names are the app's to choose and a strict object would strip
 * every one of them. Derived (`_`-prefixed) keys are excluded by construction —
 * see `derived-keys.ts` for why no `configSchema` may ever declare one.
 */
const PLATFORM_CONFIG_SHAPE = {
  type: z.string().optional(),
  appId: z.string().optional(),
  appSlug: z.string().optional(),
  blockId: z.string().optional(),
  installationId: z.string().optional(),
  /** Bound `Credential` id. Absent ⇒ follow the workspace default (§0 S1). */
  connectionId: z.string().optional(),
  title: z.string().optional(),
  desc: z.string().optional(),
  /** `false` ⇒ the field holds a variable ref; `true`/absent ⇒ a literal. */
  fieldModes: z.record(z.string(), z.boolean()).optional(),
  collapsed: z.boolean().optional(),
  inferredSchema: z.unknown().optional(),
} as const

/** Distinct values in first-seen order. */
function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values))
}

/** `_metadata` of one SDK field node, or `{}`. */
function fieldMetadata(node: unknown): Record<string, unknown> {
  return ((node as { _metadata?: Record<string, unknown> } | null)?._metadata ?? {}) as Record<
    string,
    unknown
  >
}

/**
 * The block's own input field names — the keys of its `inputsJsonSchema` field-
 * node map, minus anything the platform owns or derives.
 *
 * `inputsJsonSchema` is `{}` on catalogs published before the projection
 * existed, in which case there are no declared inputs and every consumer here
 * degrades to the `PLATFORM_NODE_DATA_KEYS` denylist — the same fallback
 * `isAppInputField` documents.
 */
function declaredInputNames(block: CachedWorkflowBlock): string[] {
  return Object.keys(block.inputsJsonSchema ?? {}).filter(
    (name) => name !== 'resource' && name !== 'operation' && isAppInputField(name, undefined)
  )
}

/** Declared `_metadata.defaultValue`s, for `defaultData()`. */
function defaultInputValues(block: CachedWorkflowBlock): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const name of declaredInputNames(block)) {
    const value = fieldMetadata(block.inputsJsonSchema?.[name]).defaultValue
    if (value !== undefined) defaults[name] = value
  }
  return defaults
}

/**
 * The `required` array of a dispatched tool's `inputsJsonSchema`.
 *
 * Note the shape: a tool's inputs are a REAL JSON Schema (zod → JSON Schema at
 * publish), unlike the block's own `inputsJsonSchema`, which is the SDK field
 * `toJSON()` map. The same two-shapes trap the output converters exist for.
 */
function requiredToolInputs(schema: Record<string, unknown> | undefined): string[] {
  const required = (schema as { required?: unknown } | undefined)?.required
  return Array.isArray(required) ? required.filter((n): n is string => typeof n === 'string') : []
}

/**
 * The block's config schema: every declared input optional, `resource` and
 * `operation` enumerated over the `toolMap` key set, plus the platform keys.
 *
 * Loose on purpose. Required-ness is **per operation** and this schema is per
 * type — QuickBooks has 42 operations behind one `type` — so a required field
 * here would reject 41 of them. The per-operation contract is `validate`'s job
 * (advisory) and `describe_app_block`'s (authoritative, per op).
 */
function buildAppBlockConfigSchema(block: CachedWorkflowBlock): z.ZodType<AppBlockConfig> {
  const shape: Record<string, z.ZodType> = {}

  for (const name of declaredInputNames(block)) {
    shape[name] = z.unknown()
  }

  const resources = uniqueInOrder(block.ops.map((o) => o.resource))
  const operations = uniqueInOrder(block.ops.map((o) => o.operation))
  // A pre-projection catalog has no ops; an enum over nothing would reject every
  // stored node, so fall back to a free string and let `validate` stay silent.
  shape.resource = resources.length > 0 ? z.enum(resources).optional() : z.string().optional()
  shape.operation = operations.length > 0 ? z.enum(operations).optional() : z.string().optional()

  // Platform keys last: they win a name collision, and `isAppInputField`'s
  // denylist already guarantees such a key was never an app input anyway.
  Object.assign(shape, PLATFORM_CONFIG_SHAPE)

  return z.object(shape).passthrough() as unknown as z.ZodType<AppBlockConfig>
}

/** Where an admin connects an app — named in prose because `auxx://` has no settings kind. */
function connectionsPath(inst: CachedInstalledApp): string {
  return `Settings → Apps → ${inst.app.title} → Connections (/app/settings/apps/installed/${inst.app.slug}/connections)`
}

/**
 * Tier-2 config validation for one app-block node.
 *
 * Severity discipline, because it is easy to get backwards: nothing here blocks
 * a graph mutation — `validateNodeConfigs` runs *after* the blocking gate — but
 * an `error` does refuse `run_node` for this node. So `error` means "running
 * this is guaranteed to fail", and everything approximate stays `warning`.
 *
 * The mutation-blocking half of the op check lives in `validateGraphStructure`,
 * keyed on `newNodeIds`: a freshly authored node with a fabricated operation
 * must fail the write, while a pre-existing node whose op vanished in an app
 * upgrade must never make the whole workflow uneditable. See plan 17 §0 S2.
 */
function validateAppBlockConfig(
  inst: CachedInstalledApp,
  block: CachedWorkflowBlock,
  config: AppBlockConfig
): NodeValidationResult {
  const errors: NodeValidationResult['errors'] = []
  const appTitle = inst.app.title

  // 1. Is the selected operation one this block actually dispatches?
  const resource = typeof config.resource === 'string' ? config.resource : ''
  const operation = typeof config.operation === 'string' ? config.operation : ''
  const opKeys = block.ops.map((o) => o.key)
  let op = block.ops.find((o) => o.key === `${resource}.${operation}`)

  if (block.ops.length === 0) {
    // Pre-projection catalog (no `toolMap`, or published before `ops` existed).
    // There is nothing to check against, and inventing an error would flag every
    // healthy node until the app is republished.
    op = undefined
  } else if (!resource || !operation) {
    errors.push({
      field: 'operation',
      message: `This ${appTitle} block has no operation selected, so it cannot run and produces no outputs. Set resource and operation to one of: ${opKeys.join(', ')}.`,
      type: 'error',
    })
  } else if (!op) {
    errors.push({
      field: 'operation',
      message: `"${resource}.${operation}" is not an operation this ${appTitle} block offers — the app may have changed it. Available: ${opKeys.join(', ')}.`,
      type: 'error',
    })
  }

  // 2. Required inputs of the dispatched tool. ADVISORY — most blocks forward
  //    the flat panel input to `ctx.runTool` unchanged, but some (whatsapp)
  //    project it first, so a name here is the tool's and not necessarily the
  //    block's. Never an error on that basis.
  if (op) {
    for (const name of requiredToolInputs(op.inputsJsonSchema)) {
      if (name === 'resource' || name === 'operation') continue
      const value = config[name]
      if (value !== undefined && value !== null && value !== '') continue
      errors.push({
        field: name,
        message: `"${name}" is required by ${op.key} and is empty.`,
        type: 'warning',
      })
    }
  }

  // 3. Does the WORKSPACE have a usable connection? Deliberately not keyed on a
  //    missing `connectionId`: unbound is the normal, healthy state — the
  //    runtime resolver takes its `appId` arm and picks the org default, and the
  //    canvas renders unbound as "follows the workspace default". Firing on
  //    unbound would put an issue on nearly every app node in every workflow.
  const hasDefinition = Boolean(
    inst.connectionDefinitions?.user || inst.connectionDefinitions?.organization
  )
  if (block.requiresConnection !== false) {
    if (!inst.orgConnectionPresent) {
      if (block.requiresConnection === true) {
        errors.push({
          field: 'connectionId',
          message: `${appTitle} has no workspace connection, so this block cannot run. An admin needs to connect one at ${connectionsPath(inst)}.`,
          type: 'error',
        })
      } else if (hasDefinition) {
        // `requiresConnection` is `undefined` — unknown, NOT false: the catalog
        // predates the projection. Blocking a run on the per-app approximation
        // would punish a block that may genuinely need no connection.
        errors.push({
          field: 'connectionId',
          message: `${appTitle} has no workspace connection. Blocks from this app usually need one — an admin can connect it at ${connectionsPath(inst)}.`,
          type: 'warning',
        })
      }
    } else if (
      inst.orgConnectionExpiresAt &&
      new Date(inst.orgConnectionExpiresAt).getTime() < Date.now()
    ) {
      errors.push({
        field: 'connectionId',
        message: `The workspace connection for ${appTitle} has expired. An admin needs to reconnect it at ${connectionsPath(inst)}.`,
        type: 'warning',
      })
    }
  }

  // 4. A `{{ref}}` sitting in a constant-mode field. The engine passes constant
  //    fields through RAW (`app-workflow-block-processor.ts` — `isConstant`
  //    branch), so the app receives the literal text `{{Node.field}}`. Nothing
  //    else reports this: `extractVariables` below deliberately mirrors the
  //    engine and skips constant fields, so without this the ref is invisible to
  //    ref-checking too, and the failure only shows up in the app's response.
  const fieldModes = (config.fieldModes ?? {}) as Record<string, unknown>
  for (const [name, value] of Object.entries(config)) {
    if (!isAppInputField(name, block.inputsJsonSchema)) continue
    if (fieldModes[name] === false) continue
    if (typeof value !== 'string' || !value.includes('{{') || !value.includes('}}')) continue
    errors.push({
      field: name,
      message: `"${name}" holds a variable reference but is in constant mode, so ${appTitle} receives the literal text. Set fieldModes.${name} to false.`,
      type: 'warning',
    })
  }

  return { isValid: errors.every((e) => e.type === 'warning'), errors }
}

/**
 * Every variable ref this node reads — the engine's own contract, reproduced.
 *
 * Only fields in **variable mode** (`fieldModes[field] === false`) are scanned,
 * because only those are resolved at run time; and only app input fields, per
 * `isAppInputField`. Both halves match `AppWorkflowBlockProcessor
 * .extractRequiredVariables` and the canvas's `extractAppBlockVariables`, so
 * all three agree on which strings are refs.
 *
 * A bare value with no `{{ }}` is a PICKER-mode variable path and counts as a
 * ref — the engine resolves it via `contextManager.getVariable(value)`.
 */
function extractAppBlockVariables(block: CachedWorkflowBlock, config: AppBlockConfig): string[] {
  const fieldModes = (config.fieldModes ?? {}) as Record<string, unknown>
  const refs = new Set<string>()

  for (const [name, value] of Object.entries(config)) {
    if (!isAppInputField(name, block.inputsJsonSchema)) continue
    if (fieldModes[name] !== false) continue
    if (typeof value !== 'string' || value.length === 0) continue

    if (value.includes('{{')) {
      for (const id of extractVarIdsFromString(value)) refs.add(id)
    } else {
      refs.add(value)
    }
  }

  return Array.from(refs)
}

/** How many operations to name inline before summarizing. Keeps `usage` bounded — QuickBooks has 42. */
const USAGE_OP_LIMIT = 12

/** Prompt-facing docs. `NodeAgentDocs` requires both members, so both are generated. */
function buildAgentDocs(
  inst: CachedInstalledApp,
  block: CachedWorkflowBlock
): NonNullable<NodeManifest<AppBlockConfig>['agent']> {
  const opKeys = block.ops.map((o) => o.key)
  const shown = opKeys.slice(0, USAGE_OP_LIMIT).join(', ')
  const opList =
    opKeys.length === 0
      ? 'none declared in this app version — call describe_app_block'
      : opKeys.length > USAGE_OP_LIMIT
        ? `${shown}, and ${opKeys.length - USAGE_OP_LIMIT} more (call describe_app_block)`
        : shown

  const usage =
    `A workflow block contributed by the ${inst.app.title} app. Set \`resource\` and \`operation\` first — ` +
    `every other field, and the node's outputs, depend on that selection. Operations: ${opList}. ` +
    "Remaining config keys are the block's own flat input fields; a field whose value is a " +
    '{{ref}} must also set `fieldModes.<field>` to false, or the app receives the literal text. ' +
    'Leave `connectionId` unset to use the workspace default connection.'

  const first = block.ops[0]
  const exampleConfig: AppBlockConfig = first
    ? { resource: first.resource, operation: first.operation }
    : {}
  if (first) {
    for (const name of requiredToolInputs(first.inputsJsonSchema)) {
      if (name === 'resource' || name === 'operation') continue
      exampleConfig[name] = `<${name}>`
    }
  }

  return {
    authorable: true,
    usage,
    examples: [
      {
        description: first
          ? `Run ${block.label}'s ${first.key} operation (input values are placeholders)`
          : `Add a ${block.label} block`,
        config: exampleConfig,
      },
    ],
  }
}

/**
 * Build one app block's `NodeManifest` from its catalog projection.
 *
 * Per-org data, never registered: `listManifests()` stays core-only, because
 * `catalog-coverage.test.ts` asserts exact set equality between the `NodeType`
 * enum and {registered manifests ∪ `NOT_YET_MIGRATED`}, and an app block is in
 * neither. This widens the *lookup*, never the *registry*.
 */
export function synthesizeAppBlockManifest(
  inst: CachedInstalledApp,
  block: CachedWorkflowBlock
): NodeManifest<AppBlockConfig> {
  const type = `${inst.app.id}:${block.id}`
  const displayName = block.label || block.id

  return {
    id: type,
    category: NodeCategory.INTEGRATION,
    displayName,
    description: block.description || `${inst.app.title} block`,
    // Icon NAME only — the web registry resolves it to a component. `iconKey` is
    // hardcoded `null` by the compiler today and unsupported platform-wide, and
    // `app.avatarUrl` is a URL, not a name, so it cannot stand in here.
    icon: block.iconKey || 'package',
    ...(block.color ? { color: block.color } : {}),

    defaultData: () => {
      const first = block.ops[0]
      return {
        ...defaultInputValues(block),
        // Identity last — a block may not shadow it, and `isAppInputField`'s
        // denylist means these were never app inputs to begin with.
        type,
        appId: inst.app.id,
        appSlug: inst.app.slug,
        blockId: block.id,
        title: displayName,
        // `installationId` is deliberately absent: the processor resolves it at
        // run time from `appId`, and the canvas does not persist it either.
        ...(first ? { resource: first.resource, operation: first.operation } : {}),
      }
    },

    configSchema: buildAppBlockConfigSchema(block),
    validate: (config) => validateAppBlockConfig(inst, block, config),
    extractVariables: (config) => extractAppBlockVariables(block, config),
    resolveOutputs: (config, nodeId) => resolveAppBlockOutputs(block, config, nodeId).variables,

    connection: {
      // No `branches`: an app node body renders exactly one `target` and one
      // `source` handle, so the default source handle is correct — not a
      // shortcut.
      canRunSingle: block.canRunSingle ?? true,
      /**
       * Never an input node. Until now this was enforced accidentally, by
       * `isInputNodePair` disqualifying any node whose manifest was missing —
       * which stops being true the moment app blocks have manifests. The guard
       * is now these two explicit facts: `category` is INTEGRATION (≠ INPUT),
       * and input wiring is refused outright.
       */
      acceptsInputNodes: false,
    },

    agent: buildAgentDocs(inst, block),
  }
}

/**
 * The per-org manifest lookup: core registry ∪ this org's installed app blocks.
 *
 * Built once per graph-edit operation. Deliberately NOT memoized across
 * operations: the underlying `installedApps` cache has a 900s TTL, and pinning
 * a lookup for longer than one op would let two tool calls in the same turn
 * disagree about a block's shape in a way nothing can invalidate.
 *
 * Core types win a name collision, which is free in practice — a core id has no
 * colon and an app-block type always does.
 */
export async function buildManifestLookup(orgId: string): Promise<ManifestLookup> {
  const apps = await getCachedInstalledApps(orgId)
  const byType = new Map<AppBlockType, NodeManifest<any>>()
  for (const inst of apps) {
    for (const block of inst.workflowBlocks ?? []) {
      byType.set(`${inst.app.id}:${block.id}`, synthesizeAppBlockManifest(inst, block))
    }
  }
  return (type: string) => getManifest(type) ?? byType.get(type)
}
