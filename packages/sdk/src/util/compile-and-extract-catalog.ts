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
 * Author-settable field capabilities projected onto the catalog. Shared by
 * `CatalogField` — see there.
 */
export interface CatalogFieldCapabilities {
  filterable?: boolean
  sortable?: boolean
  creatable?: boolean
  updatable?: boolean
  required?: boolean
  unique?: boolean
  computed?: boolean
  hidden?: boolean
}

/**
 * One field declaration, projected — the shared shape for `catalog.fields[]`
 * (a `defineFields` manifest field, via `CatalogAppField`), a `defineEntity`
 * entity's own fields (`CatalogEntity.fields`), and a connector OWNED
 * mapping's normalized fields (`CatalogConnectorOwnedMappingField`). Mirrors
 * the SDK's `FieldDecl` (`root/fields/define-field.ts`) plus the DB catalog
 * mirror `CatalogField` (`packages/database/src/db/schema/app-deployment.ts`)
 * — the three must stay in lock-step.
 */
export interface CatalogField {
  /** Stable id (e.g. 'customerId'). The DB column stays `appFieldKey`. */
  key: string
  /** Platform FieldType (e.g. 'TEXT', 'SINGLE_SELECT'). */
  type: string
  /** Display name — used only when not hidden. */
  name: string
  description?: string
  capabilities?: CatalogFieldCapabilities
  /** This field is an external-system identity (e.g. Shopify `customerId`) —
   *  drives the sink write-ownership rule + the `RecordIdentity` mirror. */
  identity?: boolean
  /** Select options for SINGLE_SELECT / MULTI_SELECT / TAGS. */
  options?: Array<{ value: string; label?: string; color?: string }>
  /** Sub-field set for an ADDRESS_STRUCT field. */
  addressComponents?: string[]
  /** Relationship config for RELATIONSHIP fields — `{ entityKey }` for another
   *  entity of the same app, `{ entityKind }` for a platform kind. */
  relationship?: {
    target: { entityKey: string } | { entityKind: string }
    cardinality: 'has_many' | 'has_one' | 'belongs_to' | 'many_to_many'
    inverseName?: string
  }
  /** Calc config for CALC fields. */
  calc?: { expression: string }
  /** Flag PII. Carried into the catalog; no platform consumer yet. */
  pii?: boolean
}

/**
 * An app-registered custom field, projected from the app's `fields[]`
 * declaration (`defineFields`, adding a field to an EXISTING platform
 * entity). Provisioned on install (`installation` scope) or per connected
 * account (`connection` scope), optionally hidden, removed on uninstall. See
 * docs/app-fields-and-entities-guide.md.
 */
export interface CatalogAppField extends CatalogField {
  /** `installation` (one per install) or `connection` (one per connected account). */
  scope: 'installation' | 'connection'
  /** Target entity kind (EntityRefKind) — resolved to entityDefinitionId on provision. */
  targetEntity: string
}

/**
 * A definition an app owns end to end, projected from the app's `entities[]`
 * declaration (`defineEntity`). See docs/app-fields-and-entities-guide.md.
 */
export interface CatalogEntity {
  /** Stable owner-scoped identity key — becomes `EntityDefinition.sourceKey`. */
  key: string
  /** Cosmetic API slug, collision-suffixed by the installer. */
  apiSlug: string
  singular: string
  plural: string
  description?: string
  icon?: string
  color?: string
  primaryDisplayField: string
  secondaryDisplayField?: string
  avatarField?: string
  fields: CatalogField[]
}

/** One field on a connector OWNED mapping — a `CatalogField` normalized with
 *  type/name/options/identity copied from the target entity, plus its
 *  `sourcePath`, so the platform never has to re-resolve it. */
export interface CatalogConnectorOwnedMappingField extends CatalogField {
  sourcePath: string
}

/** One field on a connector CONTRIBUTING mapping — a binding, not a full
 *  field declaration (most of its shape resolves against the existing target). */
export interface CatalogConnectorContributingMappingField {
  sourcePath: string
  /** Resolves against the target def's `systemAttribute` or field name. */
  target?: string
  /** Names a `defineFields` field declared for the same `entityKind`. */
  appField?: string
  /** Secondary identity-match flag; `'exclusive'` skips a second hit instead of binding it. */
  match?: boolean | 'exclusive'
  /** Per-field write behavior once bound. Default 'overwrite'. */
  mergeStrategy?: string
  /** Required only for a source-only field with no target/appField. */
  type?: string
  name?: string
}

/** `{ appField, from }` — fills a plain app field from connection metadata. */
export interface CatalogConnectorConnectionField {
  appField: string
  from: string
}

/** One fan-out mapping projected from a data connector's stream. */
export interface CatalogConnectorMapping {
  rootPath: string
  /** Explicit parent mapping's rootPath for the flat drilled child — see root types. */
  parentRootPath?: string
  linkMode?: 'upsert' | 'reference'
  /** Bare field key on the parent entity, or `'system:<systemAttribute>'` for
   *  a pre-existing system edge. */
  relationshipFieldKey?: string
  /** `{ entityKey }` for an entity this app owns, `{ entityKind }` for a
   *  platform kind the app merely contributes to. */
  target: { entityKey: string } | { entityKind: string }
  fields?: Array<CatalogConnectorOwnedMappingField | CatalogConnectorContributingMappingField>
  connectionFields?: CatalogConnectorConnectionField[]
}

/** One stream (fetch) projected from a data connector. */
export interface CatalogConnectorStream {
  key: string
  /** Stream scheduling — `incremental` backfills once then runs deltas. */
  syncMode?: 'snapshot' | 'incremental'
  mappings: CatalogConnectorMapping[]
  exampleRecord?: Record<string, unknown>
  /** Per-stream webhook STEERING — see `ConnectorStreamDecl.webhookTrigger` (root types). */
  webhookTrigger?: { filter?: Record<string, unknown>; paths: string[]; debounceMs?: number }
}

/**
 * A data connector projected from the app's `dataConnectors[]` declaration.
 * Carries the stream/mapping declarations + `requiresConnection` so the UI can
 * list + set up a connector without evaluating bundle code. See
 * docs/app-fields-and-entities-guide.md.
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
  /** Definitions the app owns end to end (optional — older catalogs omit it). */
  entities?: CatalogEntity[]
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
 * System attributes a contributing mapping field's `target` may never name —
 * an extract-time hard error, not a warning. The extractor cannot see the
 * platform's entity registry, so this list is a constant kept by hand; it
 * covers the record-identity columns a connector binding could otherwise
 * silently clobber (today's explicit binder skips `isWritableTarget` and binds
 * anything, see app-fields-and-entities-guide.md §2.4 "Reserved targets").
 * `order_number`, `invoice_number` and `purchase_order_number` are deliberately
 * NOT reserved: a connector that brings the source's own document number keeps
 * it, and the numbering hook only allocates when nothing was supplied ("theirs
 * if they bring one, otherwise ours", plans/money/tasks/39 section 6.5). The
 * platform mirrors that in `CONNECTOR_WRITABLE_NUMBERS_ALLOWLIST`. Quote
 * numbers stay hook-only. Detecting a **computed** field (e.g. an entity's
 * derived total) is NOT done here: the extractor has no access to
 * `FieldCapabilities.computed` for a target it doesn't own, so that check is
 * left to the platform seeder at connector-materialization time.
 */
const RESERVED_SYSTEM_ATTRIBUTES = new Set([
  'record_id',
  'created_at',
  'updated_at',
  'created_by_id',
  'quote_number',
  'part_quantity_on_hand',
])

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
  const SDK_REAL_ENTITIES = path.join(SDK_ROOT, 'lib', 'root', 'entities', 'index.js')
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
        // `defineEntity` is a validator called at module load too — same
        // real-runtime requirement as `defineFields`.
        if (args.path === '@auxx/sdk/entities') return { path: SDK_REAL_ENTITIES }
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
  const fieldsArr = (app.fields ?? []) as RawAppFieldDecl[]
  const entitiesArr = (app.entities ?? []) as RawEntity[]
  const dataConnectorsArr = (app.dataConnectors ?? []) as RawDataConnector[]

  // Empty app — nothing to publish.
  if (
    !toolsArr.length &&
    !toolsetsArr.length &&
    !workflowBlocksArr.length &&
    !workflowTriggersArr.length &&
    !fieldsArr.length &&
    !entitiesArr.length &&
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

  // Project one FieldDecl (raw) into its catalog shape. Shared by top-level
  // `fields[]`, `entities[].fields[]` and (normalized) connector owned
  // mapping fields — the one field shape, projected the same way everywhere.
  function projectFieldDecl(field: RawFieldDecl): CatalogField {
    return {
      key: field.key,
      type: field.type,
      name: field.name,
      description: field.description,
      capabilities: field.capabilities,
      identity: field.identity,
      options: field.options,
      addressComponents: field.addressComponents,
      relationship: field.relationship,
      calc: field.calc,
      pii: field.pii,
    }
  }

  // Project app-registered custom fields (`defineFields` — adds a field to an
  // EXISTING platform entity). Shape validation is light — the SDK
  // `defineField` discriminated union already enforces it at author time; the
  // platform re-validates at provision time via createCustomField. The
  // extractor adds the one check `defineFields` can't: at most one
  // `identity: true` field per `targetEntity` across the WHOLE app (several
  // `defineFields` calls can all target the same entity kind).
  const cataloguedFields: CatalogAppField[] = []
  const seenFieldKeys = new Set<string>()
  const identityFieldByTargetEntity = new Map<string, string>()
  for (const field of fieldsArr) {
    if (!field?.key) {
      return errored({ code: 'CATALOG_VALIDATION_FAILED', message: 'Field is missing key' })
    }
    const dedupeKey = `${field.targetEntity}:${field.key}`
    if (seenFieldKeys.has(dedupeKey)) {
      return errored({
        code: 'CATALOG_VALIDATION_FAILED',
        message: `Duplicate field "${field.key}" on entity "${field.targetEntity}"`,
      })
    }
    seenFieldKeys.add(dedupeKey)
    if (field.identity) {
      const existing = identityFieldByTargetEntity.get(field.targetEntity)
      if (existing) {
        return errored({
          code: 'CATALOG_VALIDATION_FAILED',
          message: `More than one identity field targets "${field.targetEntity}" ("${existing}" and "${field.key}") — at most one identity field is allowed per entity`,
        })
      }
      identityFieldByTargetEntity.set(field.targetEntity, field.key)
    }
    cataloguedFields.push({
      ...projectFieldDecl(field),
      scope: field.scope,
      targetEntity: field.targetEntity,
    })
  }

  // Project definitions the app owns end to end (`defineEntity`). Relationship
  // `{ entityKey }` targets are resolved here, against the FULL `entities[]`
  // list — a single entity module can't see its siblings, so this is the one
  // place that check can run.
  const cataloguedEntities: CatalogEntity[] = []
  const entityKeys = new Set(entitiesArr.map((e) => e.key))
  const entityFieldsByKey = new Map<string, Map<string, RawFieldDecl>>()
  for (const entity of entitiesArr) {
    if (!entity?.key) {
      return errored({ code: 'CATALOG_VALIDATION_FAILED', message: 'Entity is missing a key' })
    }
    const fieldMap = new Map<string, RawFieldDecl>()
    for (const field of entity.fields ?? []) {
      fieldMap.set(field.key, field)
      if (
        field.type === 'RELATIONSHIP' &&
        field.relationship &&
        'entityKey' in field.relationship.target
      ) {
        const targetKey = field.relationship.target.entityKey
        if (!entityKeys.has(targetKey)) {
          return errored({
            code: 'CATALOG_VALIDATION_FAILED',
            message: `Entity "${entity.key}" field "${field.key}": relationship target entityKey "${targetKey}" is not a declared entity`,
          })
        }
      }
    }
    entityFieldsByKey.set(entity.key, fieldMap)
    cataloguedEntities.push({
      key: entity.key,
      apiSlug: entity.apiSlug,
      singular: entity.singular,
      plural: entity.plural,
      description: entity.description,
      icon: entity.icon,
      color: entity.color,
      primaryDisplayField: entity.primaryDisplayField,
      secondaryDisplayField: entity.secondaryDisplayField,
      avatarField: entity.avatarField,
      fields: (entity.fields ?? []).map(projectFieldDecl),
    })
  }

  // Also resolve `{ entityKey }` relationship targets declared on a top-level
  // manifest field (a `defineFields` field on a platform entity may still
  // relate to an entity this app owns).
  for (const field of fieldsArr) {
    if (field.type !== 'RELATIONSHIP' || !field.relationship) continue
    if (!('entityKey' in field.relationship.target)) continue
    const targetKey = field.relationship.target.entityKey
    if (!entityKeys.has(targetKey)) {
      return errored({
        code: 'CATALOG_VALIDATION_FAILED',
        message: `Field "${field.key}": relationship target entityKey "${targetKey}" is not a declared entity`,
      })
    }
  }

  // Project the app-declared data connector. The stream/mapping declarations +
  // exampleRecord must survive serialization so the connector setup UI can
  // preview the source schema + recommended fan-out and the platform adapter
  // can resolve the streams without evaluating bundle code.
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

    const streams: CatalogConnectorStream[] = []
    for (const stream of connector.streams ?? []) {
      const mappings: CatalogConnectorMapping[] = []
      for (const mapping of stream.mappings ?? []) {
        const context = `Connector "${connector.id}" stream "${stream.key}" mapping "${mapping.rootPath}"`

        if ('entityKey' in mapping.target) {
          // Owned mapping — target must be a declared entity; every field's
          // `key` must exist on it. Normalize into full field decls so the
          // platform never has to re-resolve type/name/options/identity.
          const entityKey = mapping.target.entityKey
          const fieldMap = entityFieldsByKey.get(entityKey)
          if (!fieldMap) {
            return errored({
              code: 'CATALOG_VALIDATION_FAILED',
              message: `${context}: unknown entityKey "${entityKey}" — not a declared entity`,
            })
          }
          const normalizedFields: CatalogConnectorOwnedMappingField[] = []
          const ownedFields = (mapping.fields ?? []) as RawConnectorOwnedMappingField[]
          for (const field of ownedFields) {
            const entityField = fieldMap.get(field.key)
            if (!entityField) {
              return errored({
                code: 'CATALOG_VALIDATION_FAILED',
                message: `${context}: owned field key "${field.key}" is not declared on entity "${entityKey}"`,
              })
            }
            normalizedFields.push({
              ...projectFieldDecl(entityField),
              sourcePath: field.sourcePath,
            })
          }
          mappings.push({
            rootPath: mapping.rootPath,
            parentRootPath: mapping.parentRootPath,
            linkMode: mapping.linkMode,
            relationshipFieldKey: mapping.relationshipFieldKey,
            target: { entityKey },
            ...(mapping.fields ? { fields: normalizedFields } : {}),
          })
          continue
        }

        // Contributing mapping — bind onto the target's own attributes
        // (`target`) or a declared `defineFields` field (`appField`) for the
        // SAME `entityKind`.
        const entityKind = mapping.target.entityKind
        const fieldByKey = new Map(
          cataloguedFields.filter((f) => f.targetEntity === entityKind).map((f) => [f.key, f])
        )
        const contributingFields = (mapping.fields ?? []) as RawConnectorContributingMappingField[]
        for (const field of contributingFields) {
          if (field.target && RESERVED_SYSTEM_ATTRIBUTES.has(field.target)) {
            return errored({
              code: 'CATALOG_VALIDATION_FAILED',
              message: `${context}: target "${field.target}" is a reserved system attribute and cannot be bound by a contributing field`,
            })
          }
          if (field.appField && !fieldByKey.has(field.appField)) {
            return errored({
              code: 'CATALOG_VALIDATION_FAILED',
              message: `${context}: appField "${field.appField}" is not a declared field on "${entityKind}"`,
            })
          }
        }
        for (const conn of mapping.connectionFields ?? []) {
          const field = fieldByKey.get(conn.appField)
          if (!field) {
            return errored({
              code: 'CATALOG_VALIDATION_FAILED',
              message: `${context}: connectionFields "${conn.appField}" is not a declared field on "${entityKind}"`,
            })
          }
          if (field.identity) {
            return errored({
              code: 'CATALOG_VALIDATION_FAILED',
              message: `${context}: connectionFields "${conn.appField}" targets an identity field — connection metadata cannot fill an identity field`,
            })
          }
        }
        mappings.push({
          rootPath: mapping.rootPath,
          parentRootPath: mapping.parentRootPath,
          linkMode: mapping.linkMode,
          relationshipFieldKey: mapping.relationshipFieldKey,
          target: { entityKind },
          fields: mapping.fields,
          connectionFields: mapping.connectionFields,
        })
      }

      streams.push({
        key: stream.key,
        syncMode: stream.syncMode,
        mappings,
        exampleRecord: stream.exampleRecord,
        webhookTrigger: stream.webhookTrigger,
      })
    }

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
    entities: cataloguedEntities,
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

/**
 * One `FieldDecl` (raw, from the bundle) — shared by top-level `fields[]`
 * (`targetEntity`/`scope` present) and `entities[].fields[]` (absent). Mirrors
 * `root/fields/define-field.ts` `FieldDecl` / `AppFieldDefinition`.
 */
interface RawFieldDecl {
  key: string
  /** Present on a `defineFields` manifest field only. */
  targetEntity?: string
  /** Present on a `defineFields` manifest field only. */
  scope?: 'installation' | 'connection'
  type: string
  name: string
  description?: string
  options?: Array<{ value: string; label?: string; color?: string }>
  addressComponents?: string[]
  relationship?: {
    target: { entityKey: string } | { entityKind: string }
    cardinality: 'has_many' | 'has_one' | 'belongs_to' | 'many_to_many'
    inverseName?: string
  }
  calc?: { expression: string }
  capabilities?: CatalogAppField['capabilities']
  identity?: boolean
  pii?: boolean
}

/** A top-level `defineFields` manifest field (raw) — `targetEntity`/`scope`
 *  are always present here (unlike an entity's own `RawFieldDecl` fields). */
interface RawAppFieldDecl extends RawFieldDecl {
  targetEntity: string
  scope: 'installation' | 'connection'
}

/** A `defineEntity` declaration (raw, from the bundle). */
interface RawEntity {
  key: string
  apiSlug: string
  singular: string
  plural: string
  description?: string
  icon?: string
  color?: string
  primaryDisplayField: string
  secondaryDisplayField?: string
  avatarField?: string
  fields: RawFieldDecl[]
}

interface RawConnectorOwnedMappingField {
  key: string
  sourcePath: string
}

interface RawConnectorContributingMappingField {
  sourcePath: string
  target?: string
  appField?: string
  match?: boolean | 'exclusive'
  mergeStrategy?: string
  type?: string
  name?: string
}

interface RawConnectorMapping {
  rootPath: string
  parentRootPath?: string
  linkMode?: 'upsert' | 'reference'
  relationshipFieldKey?: string
  target: { entityKey: string } | { entityKind: string }
  fields?: Array<RawConnectorOwnedMappingField | RawConnectorContributingMappingField>
  connectionFields?: Array<{ appField: string; from: string }>
}

interface RawConnectorStream {
  key: string
  syncMode?: 'snapshot' | 'incremental'
  mappings: RawConnectorMapping[]
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
  entities?: ReadonlyArray<unknown>
  dataConnectors?: ReadonlyArray<unknown>
}
