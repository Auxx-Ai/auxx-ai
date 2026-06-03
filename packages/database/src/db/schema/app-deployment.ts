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
}

export interface CatalogAgentTool extends CatalogTool {
  /** LLM-facing name (snake_case). May differ from CatalogTool.name. */
  agentName: string
  /** LLM-facing description (hint style, written for model consumption). */
  agentDescription: string
  toolsetSlug: string
  idempotent?: boolean
  /**
   * Soft hint surfaced to the chat-kind agent catalog (builder recommendations
   * + picker declutter), carried verbatim from the SDK's `tool.agent.chatSafe`.
   * Absent ⇒ not chat-safe. NOT a runtime gate. The installed-apps cache
   * forwards it onto `CachedAgentTool.chatSafe` via spread. See plans/chat/v6
   * phase-3.
   */
  chatSafe?: boolean
  /**
   * Identity/record-scope args the engine fail-closes on in a visitor turn —
   * carried verbatim from the SDK's `tool.agent.identityScopedInputs`. The
   * restrictions UI reads this to flag args that must be bound for chat. See
   * plans/chat/v6 phase-3 / phase-4.
   */
  identityScopedInputs?: ReadonlyArray<{ name: string; suggestedVar?: string }>
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
