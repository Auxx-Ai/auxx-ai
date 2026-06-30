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

/** One source field declaration projected from a data connector's stream. */
export interface CatalogConnectorField {
  fieldKey: string
  sourcePath: string
  type: string
  name: string
  pii?: boolean
  capabilities?: { hidden?: boolean; filterable?: boolean }
  /** Predefined select option set (SINGLE_SELECT / MULTI_SELECT / TAGS) provisioned onto the owned column. */
  options?: Array<{ value: string; label?: string; color?: string }>
  /** Sub-field set for an ADDRESS_STRUCT field (e.g. `['street', 'city', 'state', 'country']`). */
  addressComponents?: string[]
}

/**
 * Provisioning declaration for a parent↔child relationship edge (v5). Drives
 * auto-creation of the relationship field (+ inverse) on the parent def at
 * connector materialization. Mirrors the SDK `ConnectorRelationshipDecl`.
 */
export interface CatalogConnectorRelationshipDecl {
  /** Stable field key of the edge created on the PARENT def (== `relationshipFieldKey`). */
  fieldKey: string
  /** Display name for the forward edge (e.g. `'Line Items'`). */
  name: string
  /** Forward cardinality from PARENT → this mapping's target. */
  cardinality: 'has_many' | 'has_one' | 'belongs_to' | 'many_to_many'
  /** Display name for the auto-created inverse edge on the child/target def. */
  inverseName: string
  /** Target def; omit for an owned child (resolves to the mapping's own provisioned def). */
  targetRef?: { ownedApiSlug: string } | { entityKind: string }
}

/** A recommended fan-out mapping projected from a data connector's stream. */
export interface CatalogConnectorDefaultMapping {
  rootPath: string
  linkMode?: 'upsert' | 'reference'
  relationshipFieldKey?: string
  /** Provisioning decl for the parent↔child edge — auto-creates the field at materialization. */
  relationship?: CatalogConnectorRelationshipDecl
  target:
    | {
        mode: 'owned'
        entity: { apiSlug: string; singular: string; plural: string; primaryDisplayField?: string }
      }
    | {
        mode: 'contributing'
        entityKind: string
        /** Target field keys to flag as secondary identity-match keys (e.g. `['email']`). */
        matchFieldKeys?: string[]
        /**
         * Non-identity field bindings the app author pre-declares so a contributing
         * stream is born closer to `ready` (e.g. `first_name` → contact's first-name
         * attribute). Each binds a source field to a target `contact` field by key —
         * the same resolver the match keys use, just without an `identityRole`.
         * Unresolved bindings are dropped (the row stays a `needs-mapping` draft).
         */
        fieldBindings?: { sourceFieldKey: string; targetKey: string }[]
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
}

/**
 * A data connector projected from the app's `dataConnectors[]` declaration.
 * Carries the stream/field/mapping declarations + `requiresConnection` so the
 * UI can list + set up a connector and the platform adapter can resolve streams
 * without evaluating bundle code. See
 * plans/data-connectors/claude/03-connectors-and-sources.md §4.
 */
export interface CatalogDataConnector {
  id: string
  label: string
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
