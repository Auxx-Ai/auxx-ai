// packages/sdk/src/util/compile-and-extract-catalog.ts

import * as esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'
import { complete, errored, type Result } from '../errors.js'
import type {
  AgentSurface,
  ToolActionSurface,
  ToolAgentSurface,
  ToolConfig,
} from '../root/tools/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SDK_ROOT = path.resolve(__dirname, '..', '..')

/**
 * Catalog payload baked at publish time. Read by every consumer (Kopilot
 * bridge, workflow editor, quick-action drawer, agent picker) without
 * evaluating bundle code.
 *
 * **Canonical source of truth lives in `packages/database/src/db/schema/app-deployment.ts`**.
 * This SDK file re-declares the shape so the SDK stays free of any
 * `@auxx/database` dependency (it's published as a standalone npm package
 * for app authors). The two declarations must stay in lock-step — drift is
 * flagged by the snapshot test in
 * `packages/sdk/src/util/__tests__/compile-and-extract-catalog.test.ts`.
 *
 * See plans/kopilot/agents/triggers/app-surface-implementation-plan.md §5.3.
 */
export interface CatalogTool {
  id: string
  name: string
  description: string
  inputsJsonSchema: Record<string, unknown>
  outputsJsonSchema: Record<string, unknown>
  requiresConnection: boolean
  timeoutMs: number
  streaming: boolean
  refs: Array<{ path: string[]; kind: string }>
  /**
   * One realistic example of the tool's success output, carried verbatim from
   * the SDK `tool.exampleOutput` (validated against `outputs` at author time).
   * JSON value (object or array). Absent ⇒ consumers fall back (scaffold / AI /
   * record). See plans/evals/tool-example-outputs.md.
   */
  exampleOutput?: unknown
}

export interface CatalogAgentTool extends CatalogTool {
  /** LLM-facing name (snake_case). May differ from CatalogTool.name. */
  agentName: string
  /** LLM-facing description (hint style, written for model consumption). */
  agentDescription: string
  toolsetSlug: string
  idempotent?: boolean
  /**
   * Surfaces this tool is offered on, carried verbatim from
   * `tool.agent.surfaces`. Absent ⇒ all surfaces. NOT a runtime gate. See
   * plans/chat/v6/chat-tool-availability.md.
   */
  surfaces?: AgentSurface[]
  /**
   * Advisory chat/email-warning flag, carried verbatim from
   * `tool.agent.externalSafe`. Absent ⇒ warn. NOT a gate. See
   * plans/chat/v6/chat-tool-availability.md.
   */
  externalSafe?: boolean
  /**
   * Per-input default binding, carried verbatim from `tool.agent.inputBindings`.
   * The platform resolves + clamps it from the turn's subject before execute.
   * See plans/chat/v8 phase-3.
   */
  inputBindings?: ReadonlyArray<{
    name: string
    default:
      | { kind: 'var'; ref: string | readonly string[] }
      | { kind: 'const'; value: unknown }
      | { kind: 'model' }
  }>
}

export interface CatalogAction {
  toolId: string
  label: string
  description?: string
  iconKey: string | null
  color?: string
  surface: 'ticket-header' | 'email-editor'
  requiresConfirmation?: boolean
  confirmationMessage?: string
}

export interface CatalogToolset {
  slug: string
  name: string
  description: string
  iconKey: string | null
  subGroup: string | null
}

export interface CatalogTrigger {
  id: string
  label: string
  description?: string
  iconKey: string | null
  color?: string
  inputsJsonSchema: Record<string, unknown>
  refs: Array<{ path: string[]; kind: string }>
}

export interface CatalogTriggerProjection {
  triggerId: string
  label: string
  description?: string
  iconKey: string | null
  color?: string
  inputsJsonSchema: Record<string, unknown>
  refs: Array<{ path: string[]; kind: string }>
}

export interface CatalogBlock {
  id: string
  label: string
  description?: string
  iconKey: string | null
  color?: string
  inputsJsonSchema: Record<string, unknown>
  /** Dispatch table: `${resource}.${operation}` → tool id. */
  toolMap: Record<string, string>
  refs: Array<{ path: string[]; kind: string }>
}

/**
 * An app-registered custom field, projected from the app's `fields[]`
 * declaration. Provisioned on install (`installation` scope) or per connected
 * account (`connection` scope), optionally hidden, removed on uninstall. See
 * app-registered custom fields.
 */
export interface CatalogAppField {
  /** App-stable id (e.g. 'customerId') — idempotency + reverse-lookup key. */
  appFieldKey: string
  /** `installation` (one per install) or `connection` (one per connected account). */
  scope: 'installation' | 'connection'
  /** Target entity kind (EntityRefKind) — resolved to entityDefinitionId on provision. */
  targetEntity: string
  /** Platform FieldType (e.g. 'TEXT', 'SINGLE_SELECT'). */
  type: string
  /** Display name — used only when not hidden. */
  name: string
  description?: string
  /** Select options for SINGLE_SELECT / MULTI_SELECT / TAGS. */
  options?: Array<{ value: string; label?: string; color?: string }>
  /** Relationship config for RELATIONSHIP fields. */
  relationship?: { targetEntity: string; cardinality: 'one' | 'many' }
  /** Calc config for CALC fields. */
  calc?: { expression: string }
  /** Author-settable capabilities (hidden, filterable, updatable, …). */
  capabilities?: {
    filterable?: boolean
    sortable?: boolean
    creatable?: boolean
    updatable?: boolean
    required?: boolean
    unique?: boolean
    computed?: boolean
    hidden?: boolean
  }
}

export interface CatalogPayload {
  tools: CatalogTool[]
  triggers: CatalogTrigger[]
  toolsets: CatalogToolset[]
  workflow: {
    blocks: CatalogBlock[]
    triggers: CatalogTriggerProjection[]
  }
  agent: {
    tools: CatalogAgentTool[]
    triggers: CatalogTriggerProjection[]
    toolsets: CatalogToolset[]
  }
  actions: CatalogAction[]
  /** App-registered custom fields (optional — older catalogs omit it). */
  fields?: CatalogAppField[]
}

export type CompileAndExtractCatalogError =
  | { code: 'APP_ENTRY_NOT_FOUND' }
  | { code: 'CATALOG_COMPILE_FAILED'; error: Error }
  | { code: 'CATALOG_LOAD_FAILED'; error: Error }
  | { code: 'CATALOG_VALIDATION_FAILED'; message: string }
  | { code: 'CATALOG_NOT_SERIALIZABLE'; message: string }

/**
 * Compile the app entry point in catalog-extraction mode and project the
 * resolved `app` literal into a `CatalogPayload`.
 *
 * `.server.ts(x)` imports are stubbed (their default export is a `() => {}`
 * placeholder) so the bundle can be imported in plain Node without invoking
 * server-only code. Author-side icons/PNGs are loaded as empty data-urls.
 *
 * The resulting payload is shipped through `createDeployment` and persisted
 * onto `AppDeployment.catalog`. See plans/kopilot/agents/triggers/app-surface-implementation-plan.md §5.3.
 */
export async function compileAndExtractCatalog(): Promise<
  Result<CatalogPayload | undefined, CompileAndExtractCatalogError>
> {
  const srcDirAbsolute = path.resolve('src')
  // Try common entry points
  const candidates = ['app.ts', 'app.tsx']
  let appEntry: string | undefined
  for (const c of candidates) {
    const p = path.join(srcDirAbsolute, c)
    try {
      await fs.access(p)
      appEntry = p
      break
    } catch {
      // not this one
    }
  }
  if (!appEntry) {
    return complete(undefined)
  }

  const auxxDir = path.resolve(HIDDEN_AUXX_DIRECTORY)
  await fs.mkdir(auxxDir, { recursive: true })
  const outputPath = path.join(auxxDir, 'app.catalog.mjs')

  // Stub plugin for `.server.ts(x)` imports — they're not safe to evaluate
  // at catalog-extraction time. Replace the default export with a no-op.
  const stubServerImports: esbuild.Plugin = {
    name: 'auxx-stub-server-imports',
    setup(build) {
      build.onResolve({ filter: /\.server(\.tsx?)?$/ }, (args) => ({
        path: args.path,
        namespace: 'auxx-server-stub',
      }))
      build.onLoad({ filter: /.*/, namespace: 'auxx-server-stub' }, () => ({
        contents: 'export default async () => { throw new Error("stubbed at catalog extraction") }',
        loader: 'js',
      }))
    },
  }

  // Resolver for `@auxx/sdk` and subpaths. The published package's exports
  // map most subpaths to types-only (e.g. `@auxx/sdk/client`, `@auxx/sdk/server`),
  // so there's no runtime file to load. We resolve the real entry points we
  // need (bare + `/tools` + `/workflow`) and stub the rest with an empty
  // module — the catalog extractor only reads `app.{tools,toolsets,workflow,fields}`,
  // so other surfaces don't need real runtime.
  const SDK_REAL_BARE = path.join(SDK_ROOT, 'lib', 'root', 'index.js')
  const SDK_REAL_TOOLS = path.join(SDK_ROOT, 'lib', 'root', 'tools', 'index.js')
  const SDK_REAL_WORKFLOW = path.join(SDK_ROOT, 'lib', 'root', 'workflow', 'index.js')
  const SDK_REAL_FIELDS = path.join(SDK_ROOT, 'lib', 'root', 'fields', 'index.js')
  const stubSdkSubpaths: esbuild.Plugin = {
    name: 'auxx-stub-sdk-subpaths',
    setup(build) {
      build.onResolve({ filter: /^@auxx\/sdk(\/.*)?$/ }, (args) => {
        if (args.path === '@auxx/sdk') return { path: SDK_REAL_BARE }
        if (args.path === '@auxx/sdk/tools') return { path: SDK_REAL_TOOLS }
        if (args.path === '@auxx/sdk/workflow') return { path: SDK_REAL_WORKFLOW }
        // `defineFields` runs at module load to build the catalog, so it must
        // resolve to real runtime — the no-op stub Proxy has no own enumerable
        // keys, so esbuild's CJS→ESM interop drops the named export and the
        // call throws `defineFields is not a function`.
        if (args.path === '@auxx/sdk/fields') return { path: SDK_REAL_FIELDS }
        return { path: args.path, namespace: 'auxx-sdk-stub' }
      })
      // CJS module shape with a Proxy: any named import becomes a no-op
      // function. esbuild treats CJS modules as opaque, so authors can
      // `import { Whatever } from '@auxx/sdk/client'` without esbuild
      // requiring `Whatever` to be a real declared export.
      build.onLoad({ filter: /.*/, namespace: 'auxx-sdk-stub' }, () => ({
        contents: `
          const noop = () => null;
          const handler = { get: (target, prop) => {
            if (prop in target) return target[prop];
            if (prop === '__esModule') return true;
            if (typeof prop === 'symbol') return undefined;
            return noop;
          }};
          module.exports = new Proxy({}, handler);
        `,
        loader: 'js',
      }))
    },
  }

  try {
    await esbuild.build({
      entryPoints: [appEntry],
      bundle: true,
      outfile: outputPath,
      format: 'esm',
      platform: 'node',
      target: ['node18'],
      logLevel: 'silent',
      write: true,
      loader: {
        '.png': 'empty',
        '.jpg': 'empty',
        '.jpeg': 'empty',
        '.gif': 'empty',
        '.webp': 'empty',
        '.svg': 'empty',
      },
      plugins: [stubServerImports, stubSdkSubpaths],
    })
  } catch (error) {
    return errored({
      code: 'CATALOG_COMPILE_FAILED',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }

  let appModule: { app?: unknown }
  try {
    const fileUrl = pathToFileURL(outputPath).href
    appModule = await import(`${fileUrl}?t=${Date.now()}`)
  } catch (error) {
    return errored({
      code: 'CATALOG_LOAD_FAILED',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }

  const app = appModule.app as RawApp | undefined
  if (!app) {
    return complete(undefined)
  }

  const toolsArr = (app.tools ?? []) as RawTool[]
  const toolsetsArr = (app.toolsets ?? []) as RawToolset[]
  const workflowBlocksArr = (app.workflow?.blocks ?? []) as RawBlock[]
  const workflowTriggersArr = (app.workflow?.triggers ?? []) as RawTrigger[]
  const fieldsArr = (app.fields ?? []) as RawAppField[]

  // Empty app — nothing to publish.
  if (
    !toolsArr.length &&
    !toolsetsArr.length &&
    !workflowBlocksArr.length &&
    !workflowTriggersArr.length &&
    !fieldsArr.length
  ) {
    return complete(undefined)
  }

  // Lazy import the converter — keeps it out of bundle path when no tools.
  const { zodToProviderToolSchema } = await import('../build/server/zod-to-provider-tool-schema.js')

  // Toolsets — slug encoding `app:<appSlug>:<localId>` (replace single dot).
  const slugByToolId = new Map<string, string>()
  const cataloguedToolsets: CatalogToolset[] = []
  for (const ts of toolsetsArr) {
    if (!ts?.id) {
      return errored({ code: 'CATALOG_VALIDATION_FAILED', message: 'Toolset is missing an id' })
    }
    const slug = `app:${ts.id.replace('.', ':')}`
    cataloguedToolsets.push({
      slug,
      name: ts.name,
      description: ts.description,
      iconKey: null,
      subGroup: ts.subGroup ?? null,
    })
    for (const toolId of ts.tools ?? []) {
      slugByToolId.set(toolId, slug)
    }
  }

  // Tools — top-level registry. Each tool projects into agent.tools[] and/or
  // actions[] when the corresponding surface key is present.
  const cataloguedTools: CatalogTool[] = []
  const cataloguedAgentTools: CatalogAgentTool[] = []
  const cataloguedActions: CatalogAction[] = []

  for (const tool of toolsArr) {
    if (!tool?.id) {
      return errored({ code: 'CATALOG_VALIDATION_FAILED', message: 'Tool is missing an id' })
    }
    const inputs = zodToProviderToolSchema(tool.inputs as never)
    const outputs = zodToProviderToolSchema(tool.outputs as never)

    const baseTool: CatalogTool = {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputsJsonSchema: inputs.jsonSchema,
      outputsJsonSchema: outputs.jsonSchema,
      requiresConnection: Boolean(tool.config?.requiresConnection),
      timeoutMs: tool.config?.timeout ?? 15000,
      streaming: Boolean(tool.agent?.streaming ?? tool.config?.streaming),
      refs: outputs.refs,
      // Deep-clone via JSON so the catalog carries a plain, serializable copy
      // (the top-level JSON.stringify check below still guards the payload).
      ...(tool.exampleOutput !== undefined
        ? { exampleOutput: JSON.parse(JSON.stringify(tool.exampleOutput)) }
        : {}),
    }
    cataloguedTools.push(baseTool)

    if (tool.agent) {
      const toolsetSlug = slugByToolId.get(tool.id) ?? `app:unknown:default`
      cataloguedAgentTools.push({
        ...baseTool,
        agentName: tool.agent.name ?? tool.id,
        agentDescription: tool.agent.description ?? tool.description,
        toolsetSlug,
        idempotent: tool.agent.idempotent ?? tool.config?.idempotent,
        surfaces: tool.agent.surfaces,
        externalSafe: tool.agent.externalSafe,
        inputBindings: tool.agent.inputBindings,
      })
    }

    if (tool.action) {
      cataloguedActions.push({
        toolId: tool.id,
        label: tool.action.label,
        description: tool.action.description,
        iconKey: null,
        color: tool.action.color,
        surface: tool.action.surface,
        requiresConfirmation: tool.action.requiresConfirmation,
        confirmationMessage: tool.action.confirmationMessage,
      })
    }
  }

  // Triggers — top-level registry. Each trigger projects into workflow.triggers
  // and/or agent.triggers when the corresponding surface key is present.
  const cataloguedTriggers: CatalogTrigger[] = []
  const cataloguedWorkflowTriggers: CatalogTriggerProjection[] = []
  const cataloguedAgentTriggers: CatalogTriggerProjection[] = []

  for (const trigger of workflowTriggersArr) {
    if (!trigger?.id) {
      return errored({ code: 'CATALOG_VALIDATION_FAILED', message: 'Trigger is missing an id' })
    }
    const triggerInputs = serializeWorkflowSchemaInputs(trigger.schema)
    cataloguedTriggers.push({
      id: trigger.id,
      label: trigger.label,
      description: trigger.description,
      iconKey: null,
      color: trigger.color,
      inputsJsonSchema: triggerInputs,
      refs: [],
    })
    if (trigger.workflow) {
      cataloguedWorkflowTriggers.push({
        triggerId: trigger.id,
        label: trigger.label,
        description: trigger.description,
        iconKey: null,
        color: trigger.color,
        inputsJsonSchema: triggerInputs,
        refs: [],
      })
    }
    if (trigger.agent) {
      cataloguedAgentTriggers.push({
        triggerId: trigger.id,
        label: trigger.agent.label ?? trigger.label,
        description: trigger.agent.description ?? trigger.description,
        iconKey: null,
        color: trigger.color,
        inputsJsonSchema: triggerInputs,
        refs: [],
      })
    }
  }

  // Workflow blocks — projection includes `toolMap` (dispatcher table the
  // runtime helper reads). See impl plan §6.3.
  const cataloguedBlocks: CatalogBlock[] = []
  for (const block of workflowBlocksArr) {
    if (!block?.id) {
      return errored({ code: 'CATALOG_VALIDATION_FAILED', message: 'Block is missing an id' })
    }
    cataloguedBlocks.push({
      id: block.id,
      label: block.label,
      description: block.description,
      iconKey: null,
      color: block.color,
      inputsJsonSchema: serializeWorkflowSchemaInputs(block.schema),
      toolMap: block.toolMap ?? {},
      refs: [],
    })
  }

  // Project app-registered custom fields. Validation here is light — the SDK
  // `defineField` discriminated union already enforces shape at author time;
  // the platform re-validates at provision time via createCustomField.
  const cataloguedFields: CatalogAppField[] = []
  const seenFieldKeys = new Set<string>()
  for (const field of fieldsArr) {
    if (!field?.appFieldKey) {
      return errored({ code: 'CATALOG_VALIDATION_FAILED', message: 'Field is missing appFieldKey' })
    }
    const dedupeKey = `${field.targetEntity}:${field.appFieldKey}`
    if (seenFieldKeys.has(dedupeKey)) {
      return errored({
        code: 'CATALOG_VALIDATION_FAILED',
        message: `Duplicate field "${field.appFieldKey}" on entity "${field.targetEntity}"`,
      })
    }
    seenFieldKeys.add(dedupeKey)
    cataloguedFields.push({
      appFieldKey: field.appFieldKey,
      scope: field.scope,
      targetEntity: field.targetEntity,
      type: field.type,
      name: field.name,
      description: field.description,
      options: field.options,
      relationship: field.relationship,
      calc: field.calc,
      capabilities: field.capabilities,
    })
  }

  const catalog: CatalogPayload = {
    tools: cataloguedTools,
    triggers: cataloguedTriggers,
    toolsets: cataloguedToolsets,
    workflow: {
      blocks: cataloguedBlocks,
      triggers: cataloguedWorkflowTriggers,
    },
    agent: {
      tools: cataloguedAgentTools,
      triggers: cataloguedAgentTriggers,
      toolsets: cataloguedToolsets,
    },
    actions: cataloguedActions,
    fields: cataloguedFields,
  }

  // Roundtrip-serializable check — catches non-serializable values left on
  // display metadata (functions, Date, circular refs). See impl plan §5.3.
  try {
    JSON.stringify(catalog)
  } catch (error) {
    return errored({
      code: 'CATALOG_NOT_SERIALIZABLE',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return complete(catalog)
}

/**
 * Serialize a WorkflowSchema's `inputs` object into a plain JSON record. Each
 * field carries a `toJSON()` from `base-node.ts` — fields that don't are passed
 * through as-is and rely on the JSON-serializable check at the catalog level.
 */
function serializeWorkflowSchemaInputs(
  schema: RawWorkflowSchema | undefined
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || !schema.inputs) return {}
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema.inputs)) {
    const fieldNode = field as { toJSON?: () => unknown } | undefined
    out[key] = typeof fieldNode?.toJSON === 'function' ? fieldNode.toJSON() : field
  }
  return out
}

// --- Raw types projected out of the imported bundle ---------------------------
// The bundle is loaded at runtime, so the types here are intentionally narrow.

// Loosened input shape for casting the `unknown[]` registry. The drift-prone
// surface sub-shapes are derived from the canonical `../root/tools/types.ts`
// interfaces so adding a field there can't silently break this reader.
interface RawTool {
  id: string
  name: string
  description: string
  inputs: unknown
  outputs: unknown
  exampleOutput?: unknown
  config?: ToolConfig
  agent?: ToolAgentSurface
  action?: ToolActionSurface
}

interface RawToolset {
  id: string
  name: string
  description: string
  tools?: ReadonlyArray<string>
  subGroup?: string
}

interface RawTrigger {
  id: string
  label: string
  description?: string
  color?: string
  schema?: RawWorkflowSchema
  workflow?: object
  agent?: {
    label?: string
    description?: string
    defaultEnabled?: boolean
  }
}

interface RawBlock {
  id: string
  label: string
  description?: string
  color?: string
  schema?: RawWorkflowSchema
  toolMap?: Record<string, string>
}

interface RawWorkflowSchema {
  inputs?: Record<string, unknown>
}

interface RawAppField {
  appFieldKey: string
  scope: 'installation' | 'connection'
  targetEntity: string
  type: string
  name: string
  description?: string
  options?: Array<{ value: string; label?: string; color?: string }>
  relationship?: { targetEntity: string; cardinality: 'one' | 'many' }
  calc?: { expression: string }
  capabilities?: CatalogAppField['capabilities']
}

interface RawApp {
  tools?: ReadonlyArray<unknown>
  toolsets?: ReadonlyArray<unknown>
  workflow?: {
    blocks?: ReadonlyArray<unknown>
    triggers?: ReadonlyArray<unknown>
  }
  fields?: ReadonlyArray<unknown>
}
