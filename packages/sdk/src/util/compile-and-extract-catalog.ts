// packages/sdk/src/util/compile-and-extract-catalog.ts

import * as esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { findServerFunctionModules } from '../build/server/generate-server-entry.js'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'
import { complete, errored, isErrored, type Result } from '../errors.js'
import type {
  ActionInputHint,
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
  /**
   * Per-input presentation overrides, carried verbatim from `tool.action.inputs`.
   * Drives dynamic-select pickers in the quick-action form. See
   * plans/actions/09-dynamic-action-inputs.md.
   */
  inputHints?: Record<string, ActionInputHint>
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
  /** The trigger's declared `schema.outputs` — the shape of the `triggerData`
   *  envelope it emits (e.g. `resourceId`, `updatedAt`, `topic`, `payload`). Lets a
   *  consumer offer real, labeled, envelope-relative paths (data-connector webhook
   *  binding, agent/workflow var-pickers). Optional — absent on pre-outputs catalogs. */
  outputsJsonSchema?: Record<string, unknown>
  refs: Array<{ path: string[]; kind: string }>
}

export interface CatalogTriggerProjection {
  triggerId: string
  label: string
  description?: string
  iconKey: string | null
  color?: string
  inputsJsonSchema: Record<string, unknown>
  /** See {@link CatalogTrigger.outputsJsonSchema}. */
  outputsJsonSchema?: Record<string, unknown>
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
  /** The block's declared `schema.outputs`. `{}` for router-style blocks — real
   *  outputs come per-operation from the tool `toolMap` dispatches to. Optional:
   *  absent on catalogs published before this projection. */
  outputsJsonSchema?: Record<string, unknown>
  /** `config.requiresConnection`. Optional, and `undefined` means **unknown**,
   *  NOT `false` — older catalogs carry nothing. */
  requiresConnection?: boolean
  /** `config.canRunSingle` (SDK default `true`). Optional — absent ⇒ true. */
  canRunSingle?: boolean
  /** Per-operation outputs keyed by `${resource}.${operation}` — `computeOutputs`
   *  evaluated once per `toolMap` key at publish time. `{}` for an op means
   *  UNKNOWN shape (not declared / returned nothing / threw), never "emits
   *  nothing". Optional: absent on catalogs published before this projection. */
  opOutputsJsonSchema?: Record<string, Record<string, unknown>>
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
  /** This field is an external-system identity (e.g. Shopify `customerId`) —
   *  drives the sink write-ownership rule + the `RecordIdentity` mirror. */
  identity?: boolean
}

/** One source field declaration projected from a data connector's stream. */
export interface CatalogConnectorField {
  fieldKey: string
  sourcePath: string
  type: string
  name: string
  pii?: boolean
  capabilities?: { hidden?: boolean; filterable?: boolean }
  /** Predefined select option set (SINGLE_SELECT / MULTI_SELECT / TAGS). */
  options?: Array<{ value: string; label?: string; color?: string }>
  /** Sub-field set for an ADDRESS_STRUCT field. */
  addressComponents?: string[]
  /** This field's value is the owned record's stable external id (dedupe/link key). */
  isExternalId?: boolean
}

/** Provisioning decl for a parent↔child edge — mirrors SDK `ConnectorRelationshipDecl`. */
export interface CatalogConnectorRelationshipDecl {
  fieldKey: string
  name: string
  cardinality: 'has_many' | 'has_one' | 'belongs_to' | 'many_to_many'
  inverseName: string
  targetRef?: { ownedKey: string } | { entityKind: string }
}

/** A recommended fan-out mapping projected from a data connector's stream. */
export interface CatalogConnectorDefaultMapping {
  rootPath: string
  linkMode?: 'upsert' | 'reference'
  relationshipFieldKey?: string
  relationship?: CatalogConnectorRelationshipDecl
  target:
    | {
        mode: 'owned'
        entity: {
          /** Stable owner-scoped identity key (distinct from cosmetic `apiSlug`). */
          key: string
          apiSlug: string
          singular: string
          plural: string
          primaryDisplayField?: string
          /** `fieldKey` of a URL/FILE field to wire as the def's avatar/display image. */
          avatarField?: string
        }
      }
    | {
        mode: 'contributing'
        entityKind: string
        matchFieldKeys?: string[]
        fieldBindings?: { sourceFieldKey: string; targetKey?: string; targetAppField?: string }[]
        connectionAppFields?: { appFieldKey: string; from: string }[]
      }
}

/** One stream (fetch) projected from a data connector. */
export interface CatalogConnectorStream {
  key: string
  displayFieldKey: string
  /** Stream scheduling — `incremental` backfills once then runs deltas. */
  syncMode?: 'snapshot' | 'incremental'
  fields: CatalogConnectorField[]
  defaultMappings?: CatalogConnectorDefaultMapping[]
  exampleRecord?: Record<string, unknown>
  /** Per-stream webhook STEERING — see `ConnectorStreamDecl.webhookTrigger` (root types). */
  webhookTrigger?: { filter?: Record<string, unknown>; paths: string[]; debounceMs?: number }
}

/**
 * A data connector projected from the app's `dataConnectors[]` declaration.
 * Carries the stream/field/mapping declarations + `requiresConnection` so the
 * UI can list + set up a connector without evaluating bundle code. See
 * plans/data-connectors/claude/03-connectors-and-sources.md §4.
 */
export interface CatalogDataConnector {
  id: string
  label: string
  /** One-line description shown in the connect-a-source picker (optional). */
  description: string | null
  requiresConnection: boolean
  iconKey: string | null
  /** Connector-level config schema (JSON Schema, from the `config` zod schema). */
  configJsonSchema: Record<string, unknown>
  /**
   * Per-config-field presentation overrides (same `dynamic-select` shape as a
   * quick-action's `inputHints`), carried beside the bare JSON Schema so a config
   * field can render as a tool-backed dropdown. Keyed by config field.
   */
  configOptionHints?: Record<string, ActionInputHint>
  streams: CatalogConnectorStream[]
  /** Connector-level webhook SIGNAL — see `DataConnectorDefinition.webhookTrigger` (root types). */
  webhookTrigger?: { triggerId: string }
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
  /** App-declared data connectors (optional — older catalogs omit it). */
  dataConnectors?: CatalogDataConnector[]
  /** Ids of app-side event handlers this deployment declares, e.g.
   *  'connection-added', 'connection-identify'. Missing/older catalogs omit it →
   *  treat as []. */
  events?: string[]
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
  const SDK_REAL_DATA_CONNECTORS = path.join(SDK_ROOT, 'lib', 'root', 'data-connectors', 'index.js')
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
        // `defineDataConnector` is a validator called at module load too — same
        // real-runtime requirement as `defineFields`.
        if (args.path === '@auxx/sdk/data-connectors') return { path: SDK_REAL_DATA_CONNECTORS }
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
  const dataConnectorsArr = (app.dataConnectors ?? []) as RawDataConnector[]

  // Empty app — nothing to publish.
  if (
    !toolsArr.length &&
    !toolsetsArr.length &&
    !workflowBlocksArr.length &&
    !workflowTriggersArr.length &&
    !fieldsArr.length &&
    !dataConnectorsArr.length
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
        ...(tool.action.inputs ? { inputHints: tool.action.inputs } : {}),
      })
    }
  }

  // Validate dynamic-select hints now that every tool id is known. Each
  // `optionsFrom` must reference a tool in this same app, and `valuePath` /
  // `labelTemplate` must be present so the form can render an option.
  const toolIds = new Set(cataloguedTools.map((t) => t.id))
  for (const action of cataloguedActions) {
    for (const [fieldKey, hint] of Object.entries(action.inputHints ?? {})) {
      if (hint.kind !== 'dynamic-select') continue
      const ds = hint.dynamicSelect
      if (!toolIds.has(ds.optionsFrom)) {
        return errored({
          code: 'CATALOG_VALIDATION_FAILED',
          message: `Action "${action.toolId}" input "${fieldKey}": optionsFrom "${ds.optionsFrom}" is not a tool in this app`,
        })
      }
      if (!ds.valuePath || !ds.labelTemplate) {
        return errored({
          code: 'CATALOG_VALIDATION_FAILED',
          message: `Action "${action.toolId}" input "${fieldKey}": dynamic-select requires valuePath and labelTemplate`,
        })
      }
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
    const triggerOutputs = serializeWorkflowSchemaOutputs(trigger.schema)
    cataloguedTriggers.push({
      id: trigger.id,
      label: trigger.label,
      description: trigger.description,
      iconKey: null,
      color: trigger.color,
      inputsJsonSchema: triggerInputs,
      outputsJsonSchema: triggerOutputs,
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
        outputsJsonSchema: triggerOutputs,
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
        outputsJsonSchema: triggerOutputs,
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
      outputsJsonSchema: serializeWorkflowSchemaOutputs(block.schema),
      opOutputsJsonSchema: projectOpOutputs(block),
      toolMap: block.toolMap ?? {},
      refs: [],
      // Spread-when-present, never `?? false`: a consumer must be able to tell
      // "the author said no" from "this catalog predates the projection".
      ...(block.config?.requiresConnection !== undefined
        ? { requiresConnection: block.config.requiresConnection }
        : {}),
      ...(block.config?.canRunSingle !== undefined
        ? { canRunSingle: block.config.canRunSingle }
        : {}),
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
      identity: field.identity,
    })
  }

  // Project app-declared data connectors. The stream/field/mapping
  // declarations + exampleRecord must survive serialization so the connector
  // setup UI can preview the source schema + recommended fan-out and the
  // platform adapter can resolve the streams without evaluating bundle code.
  const cataloguedDataConnectors: CatalogDataConnector[] = []
  const seenConnectorIds = new Set<string>()
  for (const connector of dataConnectorsArr) {
    if (!connector?.id) {
      return errored({
        code: 'CATALOG_VALIDATION_FAILED',
        message: 'Data connector is missing an id',
      })
    }
    if (seenConnectorIds.has(connector.id)) {
      return errored({
        code: 'CATALOG_VALIDATION_FAILED',
        message: `Duplicate data connector id "${connector.id}"`,
      })
    }
    seenConnectorIds.add(connector.id)

    const configJsonSchema = connector.config
      ? zodToProviderToolSchema(connector.config as never).jsonSchema
      : {}

    // Validate each config-field dynamic-select hint against this app's tools —
    // same rules as action `inputHints` (optionsFrom must be a local tool;
    // valuePath + labelTemplate are required to render an option).
    for (const [fieldKey, hint] of Object.entries(connector.configOptions ?? {})) {
      if (hint.kind !== 'dynamic-select') continue
      const ds = hint.dynamicSelect
      if (!toolIds.has(ds.optionsFrom)) {
        return errored({
          code: 'CATALOG_VALIDATION_FAILED',
          message: `Connector "${connector.id}" config "${fieldKey}": optionsFrom "${ds.optionsFrom}" is not a tool in this app`,
        })
      }
      if (!ds.valuePath || !ds.labelTemplate) {
        return errored({
          code: 'CATALOG_VALIDATION_FAILED',
          message: `Connector "${connector.id}" config "${fieldKey}": dynamic-select requires valuePath and labelTemplate`,
        })
      }
    }

    // Cross-validate app-field-targeting contributing bindings against this app's
    // declared `fields[]` (identity plan, phase 3): `targetAppField` must name a
    // field the app declares for the SAME contributing entityKind;
    // `connectionAppFields` must name a declared NON-identity field there too
    // (connection metadata can't fill an identity cell).
    for (const stream of connector.streams ?? []) {
      for (const mapping of stream.defaultMappings ?? []) {
        if (mapping.target.mode !== 'contributing') continue
        const { entityKind, fieldBindings, connectionAppFields } = mapping.target
        const fieldByKey = new Map(
          cataloguedFields
            .filter((f) => f.targetEntity === entityKind)
            .map((f) => [f.appFieldKey, f])
        )
        for (const binding of fieldBindings ?? []) {
          if (!binding.targetAppField) continue
          if (!fieldByKey.has(binding.targetAppField)) {
            return errored({
              code: 'CATALOG_VALIDATION_FAILED',
              message: `Connector "${connector.id}" stream "${stream.key}": targetAppField "${binding.targetAppField}" is not a declared field on "${entityKind}"`,
            })
          }
        }
        for (const conn of connectionAppFields ?? []) {
          const field = fieldByKey.get(conn.appFieldKey)
          if (!field) {
            return errored({
              code: 'CATALOG_VALIDATION_FAILED',
              message: `Connector "${connector.id}" stream "${stream.key}": connectionAppFields "${conn.appFieldKey}" is not a declared field on "${entityKind}"`,
            })
          }
          if (field.identity) {
            return errored({
              code: 'CATALOG_VALIDATION_FAILED',
              message: `Connector "${connector.id}" stream "${stream.key}": connectionAppFields "${conn.appFieldKey}" targets an identity field — connection metadata cannot fill an identity field`,
            })
          }
        }
      }
    }

    const streams: CatalogConnectorStream[] = (connector.streams ?? []).map((stream) => ({
      key: stream.key,
      displayFieldKey: stream.displayFieldKey,
      syncMode: stream.syncMode,
      // Flatten the `fieldKey → decl` map into an array, carrying the key.
      fields: Object.entries(stream.fields ?? {}).map(([fieldKey, decl]) => ({
        fieldKey,
        sourcePath: decl.sourcePath,
        type: decl.type,
        name: decl.name,
        pii: decl.pii,
        capabilities: decl.capabilities,
        options: decl.options,
        addressComponents: decl.addressComponents,
        isExternalId: decl.isExternalId,
      })),
      defaultMappings: stream.defaultMappings,
      exampleRecord: stream.exampleRecord,
      webhookTrigger: stream.webhookTrigger,
    }))

    cataloguedDataConnectors.push({
      id: connector.id,
      label: connector.label,
      description: connector.description ?? null,
      requiresConnection: Boolean(connector.requiresConnection),
      iconKey: connector.iconKey ?? null,
      configJsonSchema,
      ...(connector.configOptions ? { configOptionHints: connector.configOptions } : {}),
      streams,
      webhookTrigger: connector.webhookTrigger,
    })
  }

  // Declared event handlers — files under the events dir (`src/events` by
  // convention). Not part of the projected `app` literal, so scan the filesystem
  // the same way the server-entry generator does: `*.event.{js,ts}` → strip the
  // suffix to the handler id (e.g. 'connection-identify'). A missing events dir
  // is not an error — treat as no declared events.
  const eventsDirAbsolute = path.join(srcDirAbsolute, 'events')
  const eventModulesResult = await findServerFunctionModules(eventsDirAbsolute, 'event')
  const eventIds = isErrored(eventModulesResult)
    ? []
    : eventModulesResult.value.map((p) => p.replace(/\.event\.(js|ts)$/, ''))

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
    dataConnectors: cataloguedDataConnectors,
    events: eventIds,
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
 * Evaluate a block's `computeOutputs` per `toolMap` key, so the catalog carries
 * the per-selection output shapes the canvas computes live in the app iframe.
 * Without this the server sees only the dispatched TOOL's declared outputs,
 * which is an open `z.record` on most published apps.
 *
 * `computeOutputs` returns the same `Record<string, FieldNode>` shape as
 * `schema.outputs`, so the existing field serializer handles its result
 * unchanged.
 *
 * Most blocks read only `resource` + `operation`, but some condition on another
 * input too (slack's `message.send` on `sendTo`), so each select-typed input is
 * additionally varied one value at a time and the results unioned — see the
 * comments in the loop for why one-at-a-time and what the union costs.
 */
function selectOptionValues(
  inputsJsonSchema: Record<string, unknown>
): Array<readonly [string, unknown[]]> {
  const out: Array<readonly [string, unknown[]]> = []
  for (const [name, node] of Object.entries(inputsJsonSchema)) {
    // `resource`/`operation` are already the loop axis — varying them here would
    // ask a block about a selection that is not the one being projected.
    if (name === 'resource' || name === 'operation') continue
    const options = (node as { _metadata?: { options?: unknown } } | null)?._metadata?.options
    if (!Array.isArray(options) || options.length === 0) continue
    const values = options.map((o) =>
      o && typeof o === 'object' && 'value' in o ? (o as { value: unknown }).value : o
    )
    out.push([name, values] as const)
  }
  return out
}

function projectOpOutputs(block: RawBlock): Record<string, Record<string, unknown>> {
  const computeOutputs = block.schema?.computeOutputs
  const toolMapKeys = Object.keys(block.toolMap ?? {})
  const opOutputs: Record<string, Record<string, unknown>> = {}

  if (typeof computeOutputs !== 'function') {
    for (const key of toolMapKeys) {
      const [resource, operation] = key.split('.')
      if (resource && operation) opOutputs[key] = {}
    }
    return opOutputs
  }

  const selects = selectOptionValues(serializeWorkflowSchemaInputs(block.schema))

  for (const key of toolMapKeys) {
    const [resource, operation] = key.split('.')
    if (!resource || !operation) continue

    // THIRD-PARTY CODE RUNS HERE. Every call is caught independently: one
    // selection that throws must degrade to nothing, never fail the author's
    // whole publish. The extraction bundle also stubs `@auxx/sdk/client` and
    // every `*.server` module, so a `computeOutputs` reaching into either gets a
    // null-returning no-op or a throw — which is what this absorbs.
    const call = (inputs: Record<string, unknown>): Record<string, unknown> => {
      try {
        return serializeWorkflowSchemaFields(computeOutputs(inputs))
      } catch {
        return {}
      }
    }

    // The base selection first, so its fields keep leading position, then each
    // select input varied ONE AT A TIME and unioned. One-at-a-time keeps this
    // O(sum of options) rather than O(product) — and it is a no-op for the
    // blocks whose `computeOutputs` reads only resource+operation, which is all
    // of them but slack's `message.send` / `sendTo`.
    //
    // The union is a SUPERSET for conditional outputs: the agent may see a field
    // that only appears under a different selection. That is the safe direction
    // (never missing a field the block can emit); the canvas still computes the
    // exact per-selection set live, because there the conditioning input is set.
    let merged = call({ resource, operation })
    for (const [field, values] of selects) {
      for (const value of values) {
        merged = { ...merged, ...call({ resource, operation, [field]: value }) }
      }
    }
    opOutputs[key] = merged
  }

  return opOutputs
}

/**
 * Serialize a WorkflowSchema's `inputs` object into a plain JSON record. Each
 * field carries a `toJSON()` from `base-node.ts` — fields that don't are passed
 * through as-is and rely on the JSON-serializable check at the catalog level.
 */
function serializeWorkflowSchemaInputs(
  schema: RawWorkflowSchema | undefined
): Record<string, unknown> {
  return serializeWorkflowSchemaFields(schema?.inputs)
}

/**
 * Serialize a trigger/block's declared `schema.outputs` (the shape of the data it
 * emits — for an app trigger, the `triggerData` envelope) the same way inputs are
 * serialized. `{}` when no outputs are declared. Drives the labeled output-path
 * pickers (data-connector webhook token binding, agent/workflow var refs).
 */
function serializeWorkflowSchemaOutputs(
  schema: RawWorkflowSchema | undefined
): Record<string, unknown> {
  return serializeWorkflowSchemaFields(schema?.outputs)
}

/** Serialize a workflow-schema field map (`{ key: FieldNode }`) to plain JSON,
 *  preferring each node's `toJSON()` when present. */
function serializeWorkflowSchemaFields(
  fields: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!fields || typeof fields !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(fields)) {
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
  /** `WorkflowBlockConfig` — only the two members the catalog projects. */
  config?: { requiresConnection?: boolean; canRunSingle?: boolean }
}

interface RawWorkflowSchema {
  inputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
  /**
   * The block's dynamic-output function. Called at publish time, once per
   * `toolMap` key — see {@link projectOpOutputs}. Returns the same
   * `Record<string, FieldNode>` shape as `outputs`, so the existing field
   * serializer consumes it unchanged.
   */
  computeOutputs?: (inputs: Record<string, unknown>) => Record<string, unknown>
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
  identity?: boolean
}

interface RawConnectorFieldDecl {
  sourcePath: string
  type: string
  name: string
  pii?: boolean
  capabilities?: { hidden?: boolean; filterable?: boolean }
  options?: Array<{ value: string; label?: string; color?: string }>
  addressComponents?: string[]
  isExternalId?: boolean
}

interface RawConnectorStream {
  key: string
  displayFieldKey: string
  syncMode?: 'snapshot' | 'incremental'
  fields: Record<string, RawConnectorFieldDecl>
  defaultMappings?: CatalogConnectorDefaultMapping[]
  exampleRecord?: Record<string, unknown>
  webhookTrigger?: { filter?: Record<string, unknown>; paths: string[]; debounceMs?: number }
}

interface RawDataConnector {
  id: string
  label: string
  description?: string
  requiresConnection?: boolean
  iconKey?: string
  /** zod schema — projected to JSON Schema via zodToProviderToolSchema. */
  config?: unknown
  /** Per-config-field presentation overrides (tool-backed dynamic selects). */
  configOptions?: Record<string, ActionInputHint>
  streams: RawConnectorStream[]
  webhookTrigger?: { triggerId: string }
}

interface RawApp {
  tools?: ReadonlyArray<unknown>
  toolsets?: ReadonlyArray<unknown>
  workflow?: {
    blocks?: ReadonlyArray<unknown>
    triggers?: ReadonlyArray<unknown>
  }
  fields?: ReadonlyArray<unknown>
  dataConnectors?: ReadonlyArray<unknown>
}
