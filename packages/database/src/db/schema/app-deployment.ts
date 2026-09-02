// packages/database/src/db/schema/app-deployment.ts
// Immutable deployment snapshot. Each row represents "this code was deployed at this time."

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { App } from './app'
import { AppBundle } from './app-bundle'
import { Organization } from './organization'

/**
 * Catalog payload baked at SDK publish time and read by every consumer
 * (Kopilot bridge, workflow editor, quick-action drawer, agent picker)
 * without evaluating bundle code.
 *
 * Single source of truth for the shape — imported by:
 *  - packages/sdk (build pipeline that writes it)
 *  - packages/lib/cache (envelope projection)
 *  - packages/lib/ai/kopilot/capabilities/apps (bridge reads agent.tools)
 *  - apps/web (workflow/quick-action/agent pickers)
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

/** Where an agent tool may run — mirrors `@auxx/lib` `AgentSurface`. */
export type AgentSurface = 'internal' | 'chat' | 'email' | 'builder'

export interface CatalogAgentTool extends CatalogTool {
  /** LLM-facing name (snake_case). May differ from CatalogTool.name. */
  agentName: string
  /** LLM-facing description (hint style, written for model consumption). */
  agentDescription: string
  toolsetSlug: string
  idempotent?: boolean
  /**
   * Surfaces this tool is offered on, carried verbatim from the SDK's
   * `tool.agent.surfaces`. Absent ⇒ all surfaces. NOT a runtime gate. The
   * installed-apps cache forwards it onto `CachedAgentTool` via spread. See
   * plans/chat/v6/chat-tool-availability.md.
   */
  surfaces?: AgentSurface[]
  /**
   * Advisory chat/email-warning flag, carried verbatim from the SDK's
   * `tool.agent.externalSafe`. Absent ⇒ warn. NOT a gate. See
   * plans/chat/v6/chat-tool-availability.md.
   */
  externalSafe?: boolean
  /**
   * Per-input default binding, carried verbatim from the SDK's
   * `tool.agent.inputBindings`. The installed-apps cache forwards it onto
   * `CachedAgentTool` via spread; the engine resolves + clamps it from the
   * turn's subject before execute. Structurally typed (the runtime narrows
   * `ref` to a `VarRef`). See plans/chat/v8 phase-3.
   */
  inputBindings?: ReadonlyArray<{
    name: string
    default:
      | { kind: 'var'; ref: string | readonly string[] }
      | { kind: 'const'; value: unknown }
      | { kind: 'model' }
  }>
}

/**
 * Per-input presentation override for the quick-action form. Lock-step copy of
 * the SDK `ActionInputHint` (`packages/sdk/src/root/tools/types.ts`) — the
 * database package can't depend on the published SDK. See
 * plans/actions/09-dynamic-action-inputs.md.
 */
export type ActionInputHint = { kind: 'dynamic-select'; dynamicSelect: DynamicSelectHint }

export interface DynamicSelectHint {
  optionsFrom: string
  bindArgsFrom?: Record<string, string>
  args?: Record<string, unknown>
  valuePath: string
  itemsPath?: string
  labelTemplate: string
  sublabelTemplate?: string
  emptyHint?: string
  allowCustom?: boolean
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
  /** Per-input presentation overrides, carried verbatim from `tool.action.inputs`. */
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
   *  envelope it emits (e.g. `resourceId`, `updatedAt`, `topic`, `payload`). Drives
   *  labeled, envelope-relative path pickers (data-connector webhook token binding).
   *  Optional — absent on catalogs published before trigger outputs were projected. */
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
  /**
   * The block's declared `schema.outputs`. `{}` for every router-style block in
   * practice — real outputs come **per operation** from the tool `toolMap`
   * dispatches to (see `CachedBlockOp` in `@auxx/lib`). Present for
   * completeness and for future non-router blocks.
   *
   * Optional — absent on catalogs published before this projection existed.
   */
  outputsJsonSchema?: Record<string, unknown>
  /**
   * `config.requiresConnection`.
   *
   * Optional, and `undefined` means **unknown**, NOT `false`: catalogs
   * published before this projection carry nothing, and callers must fall back
   * to the per-app approximation ("does this app have a ConnectionDefinition?")
   * rather than concluding the block needs no connection.
   */
  requiresConnection?: boolean
  /** `config.canRunSingle` (SDK default `true`). Optional — absent ⇒ true. */
  canRunSingle?: boolean
  /**
   * Per-operation outputs, keyed by `${resource}.${operation}` — the block's own
   * `schema.computeOutputs` evaluated once per `toolMap` key at publish time.
   *
   * This is the block's answer to "what do I emit for this selection", and it is
   * the same answer the canvas renders, so agent and canvas agree by
   * construction. Preferred over the dispatched tool's `outputsJsonSchema`,
   * which describes the TOOL and is an open `z.record` on most published apps.
   *
   * An entry is `{}` when the block declares no `computeOutputs`, when it
   * returns nothing for that selection, or when it threw during extraction —
   * all three mean **unknown shape**, never "emits nothing".
   *
   * Optional — absent on catalogs published before this projection.
   */
  opOutputsJsonSchema?: Record<string, Record<string, unknown>>
}

/**
 * Every field type the platform supports, as string literals. Mirrors the
 * SDK's `FieldType` (`packages/sdk/src/root/fields/field-types.ts`), which in
 * turn mirrors the `ContactFieldType` pg enum. The database package can't
 * depend on the published SDK, so this is kept in lock-step by hand.
 */
export type CatalogFieldType =
  | 'TEXT'
  | 'EMAIL'
  | 'URL'
  | 'RICH_TEXT'
  | 'PHONE_INTL'
  | 'ADDRESS'
  | 'ADDRESS_STRUCT'
  | 'FILE'
  | 'DATE'
  | 'DATETIME'
  | 'TIME'
  | 'NUMBER'
  | 'CURRENCY'
  | 'CHECKBOX'
  | 'JSON'
  | 'NAME'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'TAGS'
  | 'RELATIONSHIP'
  | 'CALC'
  | 'ACTOR'

/**
 * Per-field write behavior once a contributing connector binding lands on the
 * target. Mirrors the SDK's `FieldMergeStrategy`
 * (`packages/sdk/src/root/data-connectors/types.ts`), which in turn mirrors
 * the platform's `FieldMergeStrategy` (`packages/lib/src/write-policy/types.ts`).
 * Absent ⇒ `'overwrite'`.
 */
export type CatalogFieldMergeStrategy =
  | 'overwrite'
  | 'fill_blank'
  | 'connector_owned_only'
  | 'manual_review'
  | 'ignore'

/** Author-settable field capabilities projected onto the catalog. */
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
 * the SDK's `FieldDecl` (`packages/sdk/src/root/fields/define-field.ts`).
 */
export interface CatalogField {
  /** Stable id (e.g. 'customerId'). The DB column stays `appFieldKey`. */
  key: string
  type: CatalogFieldType
  /** Display name — used only when not hidden. */
  name: string
  description?: string
  capabilities?: CatalogFieldCapabilities
  /** This field is an external-system identity (e.g. Shopify `customerId`) —
   *  drives the sink write-ownership rule + the `RecordIdentity` mirror. */
  identity?: boolean
  /** Select options for SINGLE_SELECT / MULTI_SELECT / TAGS. */
  options?: Array<{ value: string; label?: string; color?: string }>
  /** Sub-field set for an ADDRESS_STRUCT field (e.g. `['street', 'city', 'state', 'country']`). */
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
  /** Secondary identity-match flag. */
  match?: boolean
  /** Per-field write behavior once bound. Default 'overwrite'. */
  mergeStrategy?: CatalogFieldMergeStrategy
  /** Required only for a source-only field with no target/appField. */
  type?: CatalogFieldType
  name?: string
}

/** `{ appField, from }` — fills a plain app field from connection metadata. */
export interface CatalogConnectorConnectionField {
  appField: string
  from: string
}

/**
 * One fan-out mapping projected from a data connector's stream — the unit
 * that carries source paths. `target: { entityKey }` names an entity the app
 * owns (`fields` are `CatalogConnectorOwnedMappingField[]`); `target: {
 * entityKind }` names a platform kind the app merely contributes to (`fields`
 * are `CatalogConnectorContributingMappingField[]`).
 */
export interface CatalogConnectorMapping {
  rootPath: string
  /** Explicit parent mapping's rootPath (payload-absolute) for the flat drilled child
   *  (a second mapping over the parent's own subtree). Mirrors the SDK type. */
  parentRootPath?: string
  linkMode?: 'upsert' | 'reference'
  /** Bare field key on the parent entity, or `'system:<systemAttribute>'` for
   *  a pre-existing system edge on a contributing parent. */
  relationshipFieldKey?: string
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
  /**
   * Per-stream webhook STEERING. `filter` matches against the delivery's triggerData;
   * `paths` name triggerData fields exposed to the app's execute as `triggerContext`;
   * `debounceMs` coalesces same-record bursts. See {@link CatalogDataConnector.webhookTrigger}
   * for the connector-level SIGNAL this steering pairs with.
   */
  webhookTrigger?: { filter?: Record<string, unknown>; paths: string[]; debounceMs?: number }
}

/**
 * A data connector projected from the app's `dataConnectors[]` declaration.
 * Carries the stream/mapping declarations + `requiresConnection` so the UI can
 * list + set up a connector and the platform adapter can resolve streams
 * without evaluating bundle code. See docs/app-fields-and-entities-guide.md.
 */
export interface CatalogDataConnector {
  id: string
  label: string
  /** One-line description shown in the connect-a-source picker (optional). */
  description: string | null
  requiresConnection: boolean
  iconKey: string | null
  /**
   * Request-authoring surface the connect-a-source catalog advertises (05c §2).
   * App connectors bake their request into code → 'fixed'. Optional — older
   * catalogs omit it and consumers default to 'fixed'.
   */
  requestModel?: 'builder' | 'fixed'
  /** Connector-level config schema (JSON Schema, from the `config` zod schema). */
  configJsonSchema: Record<string, unknown>
  /**
   * Per-config-field presentation overrides — same `dynamic-select` shape as a
   * quick-action's `inputHints`, carried separately because `configJsonSchema`
   * is bare JSON Schema (metadata is stripped). Lets a config field render as a
   * live dropdown backed by an app tool (`optionsFrom`). Keyed by config field.
   */
  configOptionHints?: Record<string, ActionInputHint>
  streams: CatalogConnectorStream[]
  /**
   * Connector-level webhook SIGNAL: which app trigger drives webhook-sync for this
   * connector (one per connector). E.g. `{ triggerId: 'shopify.shopify-trigger' }`.
   */
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

/** Drizzle table for AppDeployment */
export const AppDeployment = pgTable(
  'AppDeployment',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    appId: text()
      .notNull()
      .references((): AnyPgColumn => App.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    deploymentType: text().notNull(), // 'development' | 'production'

    // Bundle references (FK to content-addressed bundle rows)
    clientBundleId: text()
      .notNull()
      .references((): AnyPgColumn => AppBundle.id),
    serverBundleId: text()
      .notNull()
      .references((): AnyPgColumn => AppBundle.id),

    // Build output
    settingsSchema: jsonb().$type<{
      organization?: Record<string, any>
      user?: Record<string, any>
    }>(),

    // Static surface catalog — baked at SDK publish time. Read by every
    // consumer (Kopilot bridge, workflow editor, quick-action drawer,
    // agent picker) without evaluating bundle code. Shape is defined by
    // CatalogPayload above.
    catalog: jsonb().$type<CatalogPayload>(),

    // Dev-only fields
    targetOrganizationId: text().references((): AnyPgColumn => Organization.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    environmentVariables: jsonb().$type<Record<string, string>>(),

    // Production version label (e.g. "1.3.0", "2.0.0-beta.1")
    // Null for development deployments.
    version: text(),

    // Lifecycle status — single state machine for the full publication lifecycle.
    // Dev deployments are always 'active'. Prod deployments progress through the pipeline.
    // States: 'active' | 'pending-review' | 'in-review' | 'approved' | 'rejected' | 'withdrawn' | 'published' | 'deprecated'
    status: text().notNull().default('active'),

    // Review metadata (set when status transitions through review states)
    reviewedAt: timestamp({ precision: 3 }),
    reviewedBy: text(),
    rejectionReason: text(),
    releaseNotes: text(),

    // Metadata
    metadata: jsonb().$type<{
      cliVersion?: string
      commitSha?: string
      message?: string
    }>(),
    createdById: text(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('AppDeployment_appId_idx').on(table.appId),
    index('AppDeployment_type_idx').on(table.appId, table.deploymentType),
    index('AppDeployment_targetOrganizationId_idx').on(table.targetOrganizationId),
  ]
)
