// packages/lib/src/cache/org-cache-keys.ts

import type {
  AgentConfig,
  AgentKind,
  AgentToolBindings,
  AppAccountBinding,
  CatalogAction,
  CatalogAgentTool,
  CatalogBlock,
  CatalogDataConnector,
  CatalogToolset,
  CatalogTriggerProjection,
  ConnectionVariable,
  KnowledgeEntry,
  McpServerIcon,
  PublishedAgentPermissionPolicy,
  ToolsetEntry,
} from '@auxx/database'
import type {
  CustomFieldEntity,
  OrganizationMemberInfo,
  OrganizationRole,
  SeatType,
  UserType,
} from '@auxx/database/types'
import type { CompiledProcedure, TriggerExample } from '../agents/procedures/types'
import type { ToolCategory } from '../ai/agent-framework/types'
import type { CredentialsResponse, ProviderConfiguration } from '../ai/providers/types'
import type { ConditionGroup } from '../conditions/types'
import type { DehydratedOrganization } from '../dehydration/types'
import type { Inbox } from '../inboxes/types'
import type { KbCatalogEntry } from '../kb/catalog/kb-catalog'
import type { CachedMailFilter } from '../mail-filters/types'
import type { Overage } from '../permissions/overage-detection-service'
import type { CachedPermissionProfile } from '../permissions/profiles/types'
import type { FeatureMapObject } from '../permissions/types'
import type { CachedRecordRule } from '../record-rules/types'
import type { Resource } from '../resources/registry/types'
import type { SettingValue } from '../settings/types'
import type { CachedChannel } from './providers/channels-provider'
import type { MailGrantIndex } from './providers/mail-grant-index-provider'
import type { CachedWorkflowApp } from './providers/workflow-apps-provider'

/** Member info cached with joined user data */
export interface OrgMemberInfo extends OrganizationMemberInfo {
  /**
   * The member's ONE permission-profile binding, or `null` to resolve the system
   * template in code (§1.3). Carried here (rather than widened onto
   * `OrganizationMemberInfo`) so `memberRoleMapProvider` can derive it without a
   * second query.
   */
  permissionProfileId: string | null
  user: {
    id: string
    name: string | null
    email: string | null
    image: string | null
    userType: string
    /**
     * IANA zone (`Europe/Berlin`). Read by the Kopilot `now` prompt section
     * (`ai/kopilot/prompts/sections/now.ts`) so relative dates ("yesterday")
     * resolve in the caller's day, not the server's.
     *
     * `null` = the user never set one. **Optional, not just nullable**, because
     * `undefined` is a reachable state the reader has to survive: a `members`
     * blob written before the `v2` key bump has no such property at all.
     * Consumers MUST coalesce both to `UTC` rather than falling through to the
     * host clock.
     */
    preferredTimezone?: string | null
  } | null
}

/**
 * One entry of the `memberRoleMap` cache — the hot, per-user membership facts
 * every permission path needs without touching the DB.
 *
 * `userType` carries the principal kind (`USER` | `SYSTEM` | `AGENT`) so
 * capability composition can branch on agents (SET-semantics over an all-Full
 * base, capability layer v2 §0.2) with no extra read.
 *
 * `permissionProfileId` rides along for the same reason: the human composer needs
 * the member's ONE profile binding on every request, and a null value must
 * resolve through `systemProfileFor(role, seatType)` — both facts are already in
 * this entry, so composition costs no extra query (doc 19 §8.1).
 */
export interface MemberRoleEntry {
  role: OrganizationRole
  seatType: SeatType
  userType: UserType
  /** `null` = resolve the system template for `(role, seatType)` in code (§1.3). */
  permissionProfileId: string | null
}

/** Dehydrated subscription shape (client-safe, serializable) */
export type DehydratedSubscription = NonNullable<DehydratedOrganization['subscription']>

/** Full cached subscription shape (server-only, JSON-serializable) */
export interface CachedSubscription {
  id: string
  organizationId: string
  status: string
  plan: string
  planId: string | null
  seats: number
  billingCycle: 'MONTHLY' | 'ANNUAL'
  periodStart: string | null
  periodEnd: string | null
  endDate: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  creditsBalance: number

  // Billing provider routing. `null` = unlinked (row detached from both providers); consumers fall back to 'stripe'.
  billingProvider: 'stripe' | 'shopify' | null
  shopifyShopDomain: string | null
  capabilities: import('@auxx/billing').BillingCapabilities

  // Stripe identifiers (server-only — never send to client)
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null

  // Trial
  trialStart: string | null
  trialEnd: string | null
  hasTrialEnded: boolean
  trialConversionStatus: string | null
  isEligibleForTrial: boolean
  trialEligibilityReason: string | null

  // Scheduled changes
  scheduledPlanId: string | null
  scheduledPlan: string | null
  scheduledBillingCycle: 'MONTHLY' | 'ANNUAL' | null
  scheduledSeats: number | null
  scheduledChangeAt: string | null

  // Deletion
  lastDeletionNotificationSent: string | null
  lastDeletionNotificationDate: string | null
  deletionScheduledDate: string | null
  deletionReason: string | null

  // Custom/enterprise
  customFeatureLimits: unknown | null
  customPricingMonthly: number | null
  customPricingAnnual: number | null
  customPricingNotes: string | null
}

/** Dehydrated org profile (serializable) */
export interface DehydratedOrgProfile {
  id: string
  name: string | null
  website: string | null
  domains: string[]
  handle: string | null
  about: string | null
  createdAt: string
  completedOnboarding: boolean
  demoExpiresAt: string | null
  /** Admin suspension marker — non-null means every member is locked out. */
  disabledAt: string | null
  disabledReason: string | null
}

/** Cached AgentTrigger row (JSON-serializable). Mirrors the dispatch-relevant
 * columns from `AgentTrigger`. Fields that change on every fire
 * (`lastFiredAt`, `lastErrorAt`, `lastError`, `updatedAt`) are intentionally
 * omitted so `recordFire`/`recordError` writes never need to bust the cache.
 *
 * When adding new dispatch-relevant columns to the schema, mirror them here. */
export interface CachedAgentTrigger {
  id: string
  kind: 'scheduled' | 'event' | 'app' | 'mention' | 'assignment' | 'dm' | 'webhook-endpoint'
  enabled: boolean
  triggerType: 'created' | 'updated' | 'deleted' | null
  entityDefinitionId: string | null
  eventType: string | null
  triggerAppId: string | null
  triggerAppTriggerId: string | null
  triggerInstallationId: string | null
  triggerConnectionId: string | null
  /** For `kind: 'webhook-endpoint'`: the WebhookEndpoint id. NULL otherwise. */
  triggerWebhookEndpointId: string | null
  /** For `kind: 'webhook-endpoint'`: the topic (`orders/create`). NULL otherwise. */
  triggerTopic: string | null
  config: Record<string, unknown> | null
  instructions: Record<string, unknown> | null
}

/**
 * One agent↔procedure LINK projected for the cache, fully resolved for selection.
 * Carries the link's per-agent overrides already collapsed onto the procedure
 * defaults (`override ?? default`), plus the procedure's ACTIVE published version
 * (its `compiled` tree, pinned by `activeVersionId`). Drives Phase-1 selection and
 * the Phase-3 stepper. See plans/chat/v9/phase-4-wiring.md §4.1.
 */
export interface CachedAgentProcedure {
  // link
  linkId: string
  procedureId: string
  enabled: boolean
  priority: number
  // resolved trigger (override ?? default — precomputed at projection time)
  whenToUse: string
  triggerExamples: TriggerExample[]
  /** `[]` = no deterministic gate. */
  ruleset: ConditionGroup[]
  // pinned build — only procedures with an ACTIVE published version are projected
  activeVersionId: string
  /** The ACTIVE version's compiled step tree. */
  compiled: CompiledProcedure
}

/** Cached agent (JSON-serializable) */
export interface CachedAgent {
  id: string
  /**
   * `null` while the agent is a draft. The backing User row is materialized
   * by `completeAgentSetup`. See
   * plans/kopilot/agents/dm/option-d-defer-user-plan.md.
   */
  userId: string | null
  /**
   * Optional **run-as delegation** — when set, every run of this agent resolves
   * its capabilities from THIS user instead of the agent's own profile. The
   * engine identity stays `userId`. See
   * plans/permissions/v2/14-agent-permissions.md §0.6 and
   * `resolveAgentRunCapabilities`.
   */
  runAsUserId: string | null
  /**
   * The DRAFT permission-profile binding (plan 19 §0.16). Governs draft Chat and
   * draft eval runs only — production reads {@link permissionPolicy}, the active
   * version's immutable snapshot. `null` resolves by `kind`
   * (`internal → agent`, `chat → chat_agent`).
   */
  permissionProfileId: string | null
  createdById: string
  /** `null` while the builder hasn't named the agent yet. */
  name: string | null
  slug: string
  description: string | null
  avatarUrl: string | null
  /** Invocation surface — `'internal'` (default) or `'chat'`. Immutable after creation. */
  kind: AgentKind
  mentionable: boolean
  // ── Versioned behavior fields: the ACTIVE-VERSION view ──
  // For a set-up agent these six fields reflect the published `AgentVersion`
  // (`activeVersion.<field> ?? Agent.row.<field>` when never published). Every
  // runtime consumer (`resolveAgentConfig`, worker dispatchers, chat runtime,
  // procedure selection) is therefore version-pinned with zero call-site changes.
  // The DRAFT view is NOT cached — authoring surfaces read the Agent row directly
  // (`getAgentDetail`, `resolveAgentConfig(..., { source: 'draft' })`).
  // See plans/agents/agent-versions/build-plan.md §4.1.
  /** Tiptap doc; empty object when no prompt has been authored. */
  prompt: Record<string, unknown>
  /** Per-agent toolset configuration. Mention-sourced entries are reconciled from the prompt. */
  toolsets: ToolsetEntry[]
  /** Per-agent knowledge access rules. Mention-sourced entries are reconciled from the prompt. */
  knowledge: KnowledgeEntry[]
  /** Per-agent app account bindings keyed by app id (slug). See plans/kopilot/apps/agent-credentials.md §2. */
  appAccounts: Record<string, AppAccountBinding>
  /** Per-agent tool-binding override map — tool name → input → VarSource. See plans/chat/v8. */
  toolRestrictions: AgentToolBindings

  /** Per-agent model override in `provider:model` format; null = inherit. */
  modelId: string | null
  /**
   * The ACTIVE version's resolved authorization snapshot (plan 19 §2.3) — what
   * production, queued, and pinned-eval runs enforce, via
   * `resolveAgentRunCapabilities` → `AgentPolicyCapabilities`. `null` only for a
   * pre-setup draft with no active version.
   *
   * Joined from the SAME `AgentVersion` row as {@link activeVersionId}, so the
   * pair can never disagree — the version id IS the policy's identity key
   * (§8.1: *"versioned agent capability caches must key by `AgentVersion.id` or a
   * policy hash so an old blob cannot survive publish or restore"*). Publish,
   * restore, and discard all fire `agent.updated`, which busts this blob.
   */
  permissionPolicy: PublishedAgentPermissionPolicy | null
  /** The published version production runs; `null` while the agent is a pre-setup draft. */
  activeVersionId: string | null
  /** Number of {@link activeVersionId}; `null` when never published. */
  activeVersionNumber: number | null
  /** ISO string when chat-driven setup completed; null while in setup mode. */
  setupCompletedAt: string | null
  /** ISO string when archived; null when active. */
  archivedAt: string | null
  /** All AgentTrigger rows owned by this agent (active + disabled). Consumers filter. */
  triggers: CachedAgentTrigger[]
  /**
   * This agent's linked procedures: the link (enabled/priority/resolved trigger)
   * + its ACTIVE published version's compiled tree. One entry per `AgentProcedure`
   * link whose procedure has an `activeVersionId`; unpublished procedures are
   * excluded. `[]` for agents with no published procedures (the zero-procedure
   * short-circuit reads this). Drives selection + the stepper (Phase 4 §4).
   */
  procedures: CachedAgentProcedure[]
  /** Derived from triggers — whether direct messages to this agent are enabled. */
  dmEnabled: boolean
  /** Derived from triggers — DM trigger instructions (Tiptap doc); null if no addendum. */
  dmInstructions: Record<string, unknown> | null
  /** Derived from triggers — AgentTrigger.id for the `dm` row; null only if the row is missing. */
  dmTriggerId: string | null
  /**
   * Optional identity/presentation bag — see `AgentConfig`. During draft
   * this is the only source for `name`/`avatarAssetId`; post-setup it
   * remains as the home for `color`/`iconId`. `null` when no field has
   * been set on Agent.
   */
  config: AgentConfig | null
  createdAt: string
  updatedAt: string
}

/** Dehydrated group instance for cache (JSON-serializable) */
export interface CachedGroup {
  id: string
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
  metadata: {
    memberCount?: number
    visibility?: string
    memberType?: string
    color?: string
    icon?: string
  }
}

/** Serialized system model default (JSON-safe, dates as ISO strings) */
export interface CachedSystemModelDefault {
  id: string
  organizationId: string
  modelType: string
  provider: string
  model: string
  createdAt: string
  updatedAt: string
}

/**
 * Cached agent-tool projection: the source `CatalogAgentTool` plus two
 * pre-resolved view-model fields the kopilot UI consumes directly without
 * re-encoding or walking the toolset list.
 *
 *  - `registeredName` — the LLM-facing name the bridge registers this tool
 *    under. Third-party tools use `getRegisteredToolName(appSlug, tool.id)`
 *    = `<slugPrefix>_<id>`; the synthetic auxx row uses the bare
 *    `agentName` because built-in capabilities register under their bare
 *    snake_case name (e.g. `mail_search`). Stamped here so the client
 *    `useToolAppResolver` hook can do `Map<registeredName, …>` lookups
 *    against `ToolCallPart.name` without duplicating the encoding.
 *  - `iconId` — the resolved icon to render in `<AppIcon>`: toolset's own
 *    `iconKey` wins (multi-toolset apps like Workspace ship distinct
 *    Mail/Calendar/Drive icons), falls back to the app's `avatarUrl`, then
 *    to the Lucide `'package'` glyph so the component always has something
 *    to render.
 */
export interface CachedAgentTool extends CatalogAgentTool {
  registeredName: string
  iconId: string
  /**
   * Platform visibility class (`agents/tool-visibility.ts`). Stamped by the
   * synthetic built-in row so the eval mock editor can collapse `system`
   * reads; app tools leave it absent (⇒ `'capability'`).
   */
  category?: ToolCategory
  // `surfaces` + `externalSafe` are inherited from `CatalogAgentTool` (carried
  // through from the SDK / built-in tool defs). See
  // plans/chat/v6/chat-tool-availability.md.
}

/**
 * Cache-side projection of a toolset. Extends the SDK-defined
 * `CatalogToolset` with the fields the agent catalog renderer needs.
 * Third-party rows populate `slug`/`name`/`description`/`iconKey`/
 * `subGroup` and leave the rest `undefined` (the builder falls back
 * to sensible defaults). The synthetic auxx row populates everything.
 */
/**
 * Cache-side projection of a quick action. Extends the SDK-defined
 * `CatalogAction` with the referenced tool's `inputsJsonSchema`, joined from the
 * full `catalog.tools` registry at projection time. The quick-action form reads
 * this to render an inline input form. Joining here (rather than client-side
 * against `agent.tools`) means **action-only** tools — which carry no agent
 * surface and so are absent from `agent.tools` — still get their inputs.
 */
export interface CachedAction extends CatalogAction {
  inputsJsonSchema: Record<string, unknown>
}

/**
 * One `${resource}.${operation}` of an app workflow block, joined from the
 * deployment's **full** `catalog.tools` registry via `CatalogBlock.toolMap`.
 * Block tools carry no agent surface and so are absent from `agent.tools` —
 * the same reason `CachedAction` joins from `catalog.tools` rather than
 * client-side.
 *
 * This is the server's only view of what an app block produces.
 * `CatalogBlock` itself carries no outputs, and the block's own
 * `computeOutputs` is a function that runs inside the app iframe — see
 * `plans/kopilot/workflow/17-app-block-authoring-and-connections.md` §2.3.
 */
export interface CachedBlockOp {
  /** `${resource}.${operation}` — the `toolMap` key the dispatcher routes on. */
  key: string
  resource: string
  operation: string
  toolId: string
  /**
   * The dispatched tool's declared inputs. ADVISORY for authoring: most blocks
   * forward the flat panel input to `ctx.runTool` unchanged, but some (whatsapp)
   * project it first, so this is the tool's contract and not necessarily the
   * block's.
   */
  inputsJsonSchema: Record<string, unknown>
  /**
   * The dispatched tool's declared outputs — the shape the engine writes as
   * `${nodeId}.${field}`.
   *
   * Frequently an OPEN object (`{ type: 'object', additionalProperties: {} }`,
   * i.e. a `z.record` with no named properties): as of 2026-08-18 only 71 of
   * 261 published ops declare named output properties, and shopify/quickbooks/
   * github/stripe/ms-teams/notion/gog-sheets/gog-contacts declare none on any
   * op. Callers must treat a property-less schema as *unknown*, never as
   * "produces nothing".
   */
  outputsJsonSchema: Record<string, unknown>
  requiresConnection: boolean
  /** `tool.exampleOutput`, when the app declared one. No published app does yet. */
  exampleOutput?: unknown
}

/**
 * A workflow block projection with its per-operation contracts resolved.
 * `ops` is empty when the block declares no `toolMap`, and drops entries whose
 * tool id is missing from the catalog or whose key is not `resource.operation`.
 */
export interface CachedWorkflowBlock extends CatalogBlock {
  ops: CachedBlockOp[]
}

export interface CachedAgentToolset extends CatalogToolset {
  /** Short header text used inside the app/sub-group render. Falls back to `name`. */
  shortLabel?: string
  /** Tailwind-ish color key for `<AppIcon color>` and badges. */
  color?: string
  /** Auto-enable on agent create. Treated as `false` when undefined. */
  isDefault?: boolean
  /** Curated for the Tool-Select dialog's Popular tab. Treated as `false` when undefined. */
  isPopular?: boolean
  /** Sub-group header icon override; first non-null sibling wins. */
  subGroupIconId?: string
  /** Sub-group header color override; first non-null sibling wins. */
  subGroupColor?: string
}

/** Cached installed app shape (JSON-serializable) */
export interface CachedInstalledApp {
  installationId: string
  installationType: 'development' | 'production'
  installedAt: string // ISO string — rehydrate to Date before returning

  app: {
    id: string
    slug: string
    title: string
    description: string | null
    avatarUrl: string | null
    category: string | null
  }

  currentDeployment: {
    id: string
    version: string | null
    deploymentType: string
    status: string
    clientBundleSha: string
    /**
     * Denormalized server bundle sha — needed by the AI tool bridge to build
     * the lambda payload without an extra join. See
     * plans/kopilot/agents/tool-loading-and-execution.md §3 (decision B2).
     */
    serverBundleSha: string
    createdAt: string // ISO string — rehydrate to Date before returning
  } | null

  /**
   * Every connection method the app exposes (one per ConnectionDefinition row). The
   * authoritative axis for connecting — the connect picker appears when length > 1.
   */
  methods: {
    id: string
    key: string | null
    label: string
    description: string | null
    connectionType: string
    global: boolean
    connectionVariables: ConnectionVariable[]
    /** OAuth own-client gate (§3.1): whether BYO client id/secret is required or offered. */
    requiresOwnClient: boolean
    ownClientOptional: boolean
    ownClientReason: 'no-platform-client' | 'pending-approval' | null
  }[]

  /**
   * Connection definitions split by scope — a derived convenience view (first method per
   * scope). Either, both, or neither may be present per app. Each entry mirrors
   * `ConnectionDefinitionSummary` (including oauth2Features).
   */
  connectionDefinitions: {
    user?: {
      label: string | null
      description: string | null
      global: boolean | null
      connectionType: string
      oauth2Features: Record<string, unknown> | null
      connectionVariables: ConnectionVariable[]
    }
    organization?: {
      label: string | null
      description: string | null
      global: boolean | null
      connectionType: string
      oauth2Features: Record<string, unknown> | null
      connectionVariables: ConnectionVariable[]
    }
  }

  /**
   * Surface projections from the deployment's static catalog
   * (`AppDeployment.catalog` — see `CatalogPayload`). Each consumer reads the
   * projection it cares about without evaluating bundle code:
   *  - Kopilot bridge → `agentTools` / `agentToolsets`
   *  - Agent trigger picker → `agentTriggers`
   *  - Workflow editor → `workflowBlocks` / `workflowTriggers`
   *  - Quick-action drawer → `actions`
   *
   * See plans/kopilot/agents/triggers/app-surface-implementation-plan.md §5.3.
   */
  agentTools?: CachedAgentTool[]
  agentToolsets?: CachedAgentToolset[]
  agentTriggers?: CatalogTriggerProjection[]
  workflowBlocks?: CachedWorkflowBlock[]
  workflowTriggers?: CatalogTriggerProjection[]
  actions?: CachedAction[]
  /**
   * Data connectors this app declares (`catalog.dataConnectors`). Surfaced for
   * UI discovery so the connector picker + setup view can list an app's
   * connectors and the app-connector adapter can resolve a connector's streams
   * without evaluating bundle code. See
   * plans/data-connectors/claude/03-connectors-and-sources.md §4.
   */
  dataConnectors?: CatalogDataConnector[]

  /**
   * Org-scope connection presence + expiry (decision G2 split path).
   * Populated via LEFT JOIN on `Credential WHERE userId IS NULL`.
   * User-scope presence is a per-request direct DB hit.
   */
  orgConnectionPresent: boolean
  orgConnectionExpiresAt: string | null
}

/**
 * Cached MCP server shape (JSON-serializable). One entry per server visible to the org —
 * curated/global rows plus the org's own custom rows. Curated rows with no installation for
 * this org are still included (with `tools: []`) so the settings page can list them as
 * connectable.
 */
export interface CachedMcpServer {
  serverId: string
  slug: string
  name: string
  description: string | null
  icon: McpServerIcon | null
  /** Lets the template gallery match an org server back to its template when slugs dedupe. */
  endpoint: string
  isCustom: boolean // organizationId != null
  toolsetSlug: string // `mcp:<serverId>`
  connectionType:
    | 'oauth2-code'
    | 'client-credentials'
    | 'secret'
    | 'hosted-provision'
    | 'none'
    | null // null = no definition yet
  connectionPresent: boolean
  connectionExpiresAt: string | null
  /** Circuit breaker tripped (consecutiveRefreshFailures >= 5) — surfaces a reconnect pill. */
  needsReconnect: boolean
  tools: Array<{
    name: string // raw server-side name
    title: string | null // annotations.title, if any
    description: string | null
    readOnlyHint: boolean
    trusted: boolean // derived: trust.allTools || trust.tools includes name
    inputSchema: Record<string, unknown> // needed by the adapter
    outputSchema?: Record<string, unknown> // server/inferred/manual JSON Schema for the result
    outputSchemaSource?: 'server' | 'inferred' | 'manual'
    hasExampleOutput: boolean // example payload stays out of the hot cache; tools tab loads it on demand
  }>
  lastSyncedAt: string | null
  lastSyncError: string | null
}

/**
 * One knowledge base, reduced to the two columns article visibility needs
 * (plan v3/06 §5.3). Deliberately NOT the whole row and deliberately not
 * `KbCatalogEntry`: this blob is a permission INPUT and must not be recomputed
 * on every article save.
 */
export interface CachedKnowledgeBase {
  id: string
  /** `'standard' | 'source' | 'learned'` — `source` is never a viewable KB. */
  kind: string
}

/** All org-scoped cache keys and their data types */
export interface OrgCacheDataMap {
  // Near-immutable
  entityDefs: Record<string, string> // entityType → entityDefId
  entityDefSlugs: Record<string, string> // apiSlug → entityDefId
  systemUser: string // system user ID
  channelProviders: Record<string, string> // channelId → provider

  // Membership & permissions
  members: OrgMemberInfo[]
  memberRoleMap: Record<string, MemberRoleEntry>
  profiles: CachedPermissionProfile[] // all PermissionProfile rows (system + custom) — resolves profileId → base/ceiling at compose time
  hasPermissionGrants: boolean // whether the org has ANY PermissionGrant rows (composition fast path)
  restrictedEntityDefIds: string[] // entity defs with ≥1 type-level ResourceAccess grant (read-path enforcement §0)
  governingInstanceIds: string[] // instance ids whose access is GOVERNED by rows — a `role:org_member` row (any permission) or any `none` row (§1.3)

  // Business data
  features: FeatureMapObject
  subscription: CachedSubscription | null
  orgProfile: DehydratedOrgProfile
  resources: Resource[]
  customFields: Record<string, CustomFieldEntity[]> // entityDefId → fields
  groups: CachedGroup[] // all entity_group instances
  groupMembers: Record<string, string[]> // userId → groupInstanceIds (memberType='user' edges only)
  agents: CachedAgent[] // all Agent rows (active + archived); consumers filter archivedAt
  inboxes: Inbox[]
  mailGrantIndex: MailGrantIndex
  channels: CachedChannel[]
  overages: Overage[]
  orgSettings: Record<string, SettingValue> // key → value (org defaults only)
  installedApps: CachedInstalledApp[]
  mcpServers: CachedMcpServer[]
  workflowApps: CachedWorkflowApp[]
  recordRules: CachedRecordRule[]
  mailFilters: CachedMailFilter[] // every MailFilter row (enabled + disabled); the gate filters in memory
  kbCatalog: KbCatalogEntry[] // published AI-enabled article ToC per KB (agent prompt injection)
  knowledgeBases: CachedKnowledgeBase[] // id + kind for EVERY KB — the article-visibility allow-list (plan v3/06 §5.3)

  // AI provider data (15-min TTL, invalidated via ai-provider/model events)
  aiProviderConfigs: Record<string, ProviderConfiguration>
  aiCredentials: Record<string, CredentialsResponse>
  aiDefaultModels: Record<string, CachedSystemModelDefault>
}

export type OrgCacheKeyName = keyof OrgCacheDataMap

const ONE_DAY = 60 * 60 * 24
const THIRTY_DAYS = ONE_DAY * 30

/**
 * Key configuration: prefix for Redis keys, TTL, and local-only flag.
 *
 * `localTtlMs` overrides the in-process LocalCache window (default 100 ms) for
 * rarely-mutated keys read on every event dispatch. Trade-off: there is no
 * cache pub/sub, so PEER processes only notice an invalidation once their local
 * entry expires — cross-process staleness after an admin change equals this
 * value. Keep it small for keys whose consumers have side effects.
 */
export const ORG_CACHE_KEY_CONFIG: Record<
  OrgCacheKeyName,
  { prefix: string; ttlSeconds: number; localOnly?: boolean; localTtlMs?: number }
> = {
  // Near-immutable (30-day TTL, invalidated only on create/delete)
  entityDefs: { prefix: 'org:entity-defs', ttlSeconds: THIRTY_DAYS },
  entityDefSlugs: { prefix: 'org:entity-def-slugs', ttlSeconds: THIRTY_DAYS },
  systemUser: { prefix: 'org:system-user', ttlSeconds: THIRTY_DAYS },
  channelProviders: { prefix: 'org:int-providers', ttlSeconds: THIRTY_DAYS },

  // Membership & permissions (24h TTL, invalidated on member events)
  // v2: + `user.preferredTimezone` (the Kopilot `now` clock — sections/now.ts).
  // A v1 blob has no key, so every member would read as `undefined`. That is a
  // BENIGN miss on its own — the reader coalesces to `UTC`, which is exactly the
  // pre-change behaviour — but the bump is what makes the rollout deterministic
  // instead of "correct for whoever happens to miss the cache first", and it is
  // the repo rule for a shape change either way.
  //
  // KNOWN STALENESS, pre-existing and NOT introduced here: this blob projects
  // mutable `User` columns (`name`, `email`, `image`, and now
  // `preferredTimezone`), but `INVALIDATION_GRAPH`'s `user.updated` invalidates
  // only the USER key `userProfile` — it does not list `members`. So a profile
  // edit (including `user.updateTimezone`) is not reflected here until a
  // membership event fires or the ONE_DAY TTL lapses. The v2 keyspace move makes
  // the FIRST read after deploy correct for everyone; a LATER timezone change
  // still lags. The one-line fix is to add `members` to the `org` list of
  // `'user.updated'` in `invalidation-graph.ts`, which also repairs the
  // name/email/avatar staleness that predates this key version.
  members: { prefix: 'org:members:v2', ttlSeconds: ONE_DAY },
  // v3: + userType (agent capability composition, capability layer v2 §1).
  // v4: + permissionProfileId (the human base-profile binding — doc 19 §8.1; a v3
  // blob has no `permissionProfileId` key, so every member would read as
  // null-bound and silently ignore an explicit profile assignment).
  memberRoleMap: { prefix: 'org:member-roles:v4', ttlSeconds: ONE_DAY },
  // Permission profiles (doc 19) — read on every capability composition, mutated
  // only by admin profile edits. Invalidated via `permission-profile.changed`.
  // v2: + updatedAt (snapshotted as `sourceProfileUpdatedAt` on a published agent
  // policy — doc 19 §2.3). A v1 blob has no key, which reads as `null` rather
  // than misbehaving, but the bump keeps the audit field honest after rollout.
  // v2 → v3: `CachedPermissionProfile` gained `role` (plan 21 §3.1). A stale v2
  // blob would surface `role: undefined` to the picker rank filters.
  // v3 → v4: the agent-policy rung VOCABULARY changed (plan 26 Phase 2 —
  // `read→view`, `read_write→edit`, `full→admin`; data migration 054). The TYPE
  // is unchanged, which is exactly why this needs a bump rather than looking
  // cosmetic: `agentPolicy` is cached VERBATIM, and the new `parsePolicyPermission`
  // DROPS a retired rung as an unknown value. A v3 blob written by a draining old
  // instance therefore parses to `default: 'none'` with every override discarded —
  // the agent composes to nothing. Fail-closed, but a real outage for the full
  // ONE_DAY TTL, and a flush cannot fix it during a rollout because the old
  // instance repopulates the same keyspace.
  profiles: { prefix: 'org:permission-profiles:v4', ttlSeconds: ONE_DAY },
  hasPermissionGrants: { prefix: 'org:has-permission-grants', ttlSeconds: ONE_DAY },
  restrictedEntityDefIds: { prefix: 'org:restricted-entity-def-ids', ttlSeconds: ONE_DAY },
  // RENAMED + RE-SEMANTICIZED 2026-07-29 (`org:restricted-instance-ids` → this).
  // The TypeScript shape is unchanged — still `string[]` — and that is exactly
  // why the keyspace had to move: this is the "a value-vocabulary change needs a
  // bump too" case from the handoff's standing gotchas. The right test is not
  // "did the shape change?" but "would the current reader still be correct on a
  // blob the old writer produced?", and here it would not be.
  //
  // OLD contract: every instance carrying ≥1 instance-level row for ANYONE.
  // NEW contract: only instances carrying a GOVERNING row — a `role:org_member`
  // baseline at any permission, or any `permission = 'none'` marker.
  //
  // WHICH WAY EACH DIRECTION FAILS — worked out from the reader
  // (`effectiveInstanceLevel`), not asserted:
  //  - **Stale OLD blob read by NEW code** — the set is a SUPERSET of the correct
  //    one. New code checks the member's own row FIRST, so every grantee and every
  //    creator still resolves their real level; only a member with NO row of their
  //    own on an over-included instance is affected, and for them the set means
  //    `undefined` instead of the area fallback. **Fail-CLOSED** (lost access:
  //    exactly today's live inbox-403 regression, persisting for up to the ONE_DAY
  //    TTL).
  //  - **Stale NEW blob read by OLD code** (a draining instance during rollout) —
  //    the set is a SUBSET. Old code has no own-row-first branch, so an instance
  //    dropped from the set falls through to `instanceFallbackLevel`; for a
  //    `baselineAtCreate: false` resource that returns the member's AREA level,
  //    which means a `user @ edit`-only share would read as org-wide access.
  //    **Fail-OPEN.** That direction is the reason this is a keyspace MOVE rather
  //    than a value bump: the two contracts never share a Redis key, so a draining
  //    old instance cannot read a new blob at all — it repopulates
  //    `org:restricted-instance-ids`, which no new instance reads.
  // A flush alone would NOT have covered that second direction, which is the
  // entire reason `vN`/renames exist.
  governingInstanceIds: { prefix: 'org:governing-instance-ids', ttlSeconds: ONE_DAY },

  // Business data (24h TTL, all invalidated via cache events)
  features: { prefix: 'org:features', ttlSeconds: THIRTY_DAYS },
  // v2: + `capabilities.customPricingPlans`, which `PlanComparison` reads to hide the
  // Enterprise ("Contact Sales") card on Shopify-billed orgs — App Store rules 1.2.1 /
  // 1.2.3. `capabilities` is baked into the blob at compute time
  // (`subscription-provider.ts`), so a v1 blob has no such key and the read would
  // resolve `undefined` → the Stripe default → **the card stays visible for up to the
  // ONE_DAY TTL**, i.e. straight through the review window. Moving the keyspace makes
  // that impossible. See plans/billing/v3/04-hide-custom-pricing-plans-on-shopify.md.
  subscription: { prefix: 'org:subscription:v2', ttlSeconds: ONE_DAY },
  // v2: + disabledAt/disabledReason, which `protectedProcedure` now reads to lock
  // members out of an admin-suspended org. The shape is still parseable by both
  // sides, which is exactly why the bump is load-bearing: a v1 blob has no
  // `disabledAt` key, so the gate reads `undefined` → falsy → **fail-OPEN**, and a
  // just-suspended org would stay fully usable for up to the ONE_DAY TTL for any
  // org whose blob was written before the deploy. Moving the keyspace makes that
  // impossible. (`org.updated` invalidation only covers orgs suspended *after*
  // the new code is live.)
  orgProfile: { prefix: 'org:profile:v2', ttlSeconds: ONE_DAY },
  // v2: + firstInteractionAt/lastInteractionAt column-backed system fields on the
  // contact and company registries. The blob is the computed merged registry
  // (statics + CustomField rows), so a pre-deploy blob simply lacks the new
  // static fields for up to the ONE_DAY TTL — the bump moves the keyspace so
  // every org recomputes on first read after deploy.
  resources: { prefix: 'org:resources:v3', ttlSeconds: ONE_DAY },
  customFields: { prefix: 'org:custom-fields', ttlSeconds: ONE_DAY },
  groups: { prefix: 'org:groups', ttlSeconds: ONE_DAY },
  groupMembers: { prefix: 'org:group-members', ttlSeconds: ONE_DAY },
  // Read per CRUD event by agent-trigger dispatch — same rationale as workflowApps.
  // v2: + runAsUserId (agent run-as delegation, capability layer v2 §3.1 —
  // `resolveAgentRunCapabilities` reads it off the cached agent, so a stale
  // blob would silently resolve the agent's own profile). Bump on shape changes.
  // v3: + permissionPolicy (the active version's authorization snapshot) and
  // permissionProfileId (the draft binding) — doc 19 §2.3/§8.1. A v2 blob has
  // neither key, so every agent would resolve a `null` policy and fail closed
  // mid-rollout; the bump is what makes that impossible.
  // v4: the agent-policy rung vocabulary changed (plan 26 Phase 2, data migration
  // 054) and `permissionPolicy` is cached verbatim — same reasoning as
  // `profiles` v3 → v4 above. A v3 blob's retired rungs are dropped by
  // `parsePublishedAgentPolicy`, so the version composes to all-`none`.
  agents: { prefix: 'org:agents:v4', ttlSeconds: ONE_DAY, localTtlMs: 5_000 },
  // v8: the LENS VOCABULARY changed under this blob (plan v3/03, PR #1406):
  // `full`→`read` and `subject`→`identity`. `defaultLens` is stored VERBATIM
  // here, and #1406 bumped the two USER caches (`user:capabilities:v17`,
  // `user:instance-grants:v1`) while missing this ORG one — so a blob written
  // before migration 0319 still says `full`, and every reader that keys off it
  // gets `undefined`. `LENS_LABELS['full']` is `undefined` and the share
  // popover's inherited-access footer threw
  // `Cannot read properties of undefined (reading 'label')` on it; the lens
  // evaluator is worse, because `rungRank('full')` is `undefined` and every
  // `>=` comparison against it is FALSE, so a stale floor silently reads as no
  // floor at all. The recompute is already correct (`InboxService.floorFor`
  // reads the migrated `rung` column) — only the cached copy was wrong, which
  // is why it presents intermittently: the ONE_DAY TTL heals it within a day of
  // the org's last inbox write.
  // ⚠ The v7 note below still says "an absent row meaning `full`" — read that
  // as `read`. It is left in place as the record of what the old blobs contain.
  // v7: `defaultLens` is DERIVED FROM `ResourceAccess` ROWS (plan 40 §6) — the
  // `role:org_member` baseline row, with an absent row meaning `full` and a
  // `personal_inbox` entry always reporting `none`. The SHAPE is unchanged, which
  // is exactly why the bump is needed: a v6 blob is still parseable, so nothing
  // would fail — the old field-derived value would just keep being served for up
  // to the ONE_DAY TTL, and the surfaces that read it (the count-delta/realtime
  // audience, the inbox access badges, the share popover's inherited-access
  // footer) would keep showing the floor the org had before its last edit. Ask
  // "can the current parser still read a blob the old code wrote", not "did the
  // shape change".
  // v6: ONE merged list across BOTH inbox definitions (plan 40 §3.4) — entries
  // gained `entityDefinitionKey` ('inbox' | 'personal_inbox'), `isPersonal`
  // became DERIVED from it (OR'd with the legacy marker until data migration
  // 060 lands), and `recordId` is now always slug-keyed rather than reusing
  // `listAll`'s def-CUID form. The bump is load-bearing in BOTH directions: a
  // v5 blob read by v6 code has no `entityDefinitionKey`, so every RecordId
  // minted off it would carry `undefined` as its def, and a v6 blob read by a
  // draining v5 instance would carry personal mailboxes it has no branch for.
  // v5: defaultLens/status normalized to scalars (were SINGLE_SELECT arrays —
  // poisoned strict lens comparisons). v4: + ownerUserId (§11 personal
  // accounts). v3: + isPersonal. v2: + defaultLens (mail-permissions §2.2).
  // Bump on shape changes.
  inboxes: { prefix: 'org:inboxes:v8', ttlSeconds: ONE_DAY },
  // Reverse thread/contact/inbox grant index for realtime publish fanout
  // (§3.1) + ingest count-delta audiences (§10.1). v2: + inboxes bucket.
  mailGrantIndex: { prefix: 'org:mail-grant-index:v2', ttlSeconds: ONE_DAY },
  channels: { prefix: 'org:channels', ttlSeconds: ONE_DAY },
  overages: { prefix: 'org:overages', ttlSeconds: 900 },
  orgSettings: { prefix: 'org:settings', ttlSeconds: ONE_DAY },
  // v2: connectionDefinition (singular) → connectionDefinitions (pair). Bump on shape changes.
  // v4: CachedAction.inputHints (dynamic-select pickers). See plans/actions/09-dynamic-action-inputs.md.
  // v5: + methods[] (multi-connection-per-app). See plans/connections/multi-connection-per-app.md.
  // v6: workflowBlocks carry `ops[]` (toolMap → catalog.tools join) so the server
  //     can resolve what an app block produces. See plans/kopilot/workflow/17-*.md §4 A2.
  installedApps: { prefix: 'org:installed-apps:v6', ttlSeconds: 900 },
  mcpServers: { prefix: 'org:mcpServers', ttlSeconds: ONE_DAY },
  // Read per CRUD event by trigger dispatch; changes only on admin edits →
  // 5 s local window (dispatch enqueues jobs, so peer staleness is benign).
  //
  // v2: the cached blob carries the published `Workflow.graph` VERBATIM, and
  // that document's vocabulary changed — graphs are now stored canonically
  // (plan 23) with everything derived rebuilt by `hydrateGraph` at read. A
  // canonical graph read by pre-23 code would see a trigger config missing
  // every key whose value equals its manifest default. Bump on shape changes.
  workflowApps: { prefix: 'org:workflow-apps:v2', ttlSeconds: ONE_DAY, localTtlMs: 5_000 },
  // Read per interactive field write. Rules have side effects, so the peer
  // staleness window stays tight (1 s ≈ 10× fewer steady-state hash GETs).
  recordRules: { prefix: 'org:record-rules', ttlSeconds: ONE_DAY, localTtlMs: 1_000 },
  // Read per INBOUND MESSAGE by the `message:received` gate, and it is the §4.1
  // step-3 early exit — the read that decides whether an org pays anything at
  // all for filters. Same reasoning as `recordRules`: filters have side effects
  // on people's mail, so the peer staleness window stays tight (1 s).
  mailFilters: { prefix: 'org:mail-filters', ttlSeconds: ONE_DAY, localTtlMs: 1_000 },
  // Read once per agent turn at prompt build — stale order/titles are benign.
  kbCatalog: { prefix: 'org:kb-catalog', ttlSeconds: ONE_DAY, localTtlMs: 5_000 },
  // The article-visibility allow-list input (plan v3/06 §5.3): `SELECT id, kind
  // FROM "KnowledgeBase" WHERE organizationId = $1`, nothing else. Read on the
  // hot records-list path for `article`, and only there.
  //
  // WHY A NEW KEY RATHER THAN REUSING `kbCatalog`, which already carries id +
  // kind for every KB: `kbCatalog` is invalidated on `article.published` /
  // `article.changed` / `article.deleted`, so a permission input keyed to it
  // would be recomputed on every article keystroke-save — and the blob it
  // recomputes is the whole org ToC. This one moves only when a KB is created,
  // deleted or renamed, which is org SETUP scale.
  //
  // WHICH WAY DOES A STALE BLOB FAIL — worked out from the reader
  // (`viewableKnowledgeBaseIds`), not asserted:
  //  - **MISSING KB** (blob predates a `kb.created`) — the id never enters the
  //    allow-list, so `= ANY(...)` excludes it and every article homed or placed
  //    there vanishes from the records lane for its own creator. **Fail-CLOSED**,
  //    and it is the direction this plan deliberately accepts for the
  //    positive-form hazard (§8.3). Bounded by the `kb.created` invalidation,
  //    which is already wired.
  //  - **EXTRA KB** (blob predates a `kb.deleted`) — a dead id sits in the
  //    allow-list. Harmless: it correlates against no surviving
  //    `ArticlePlacement` row (FK `onDelete: cascade`) and no surviving
  //    `Article.homeKnowledgeBaseId`, so it admits nothing.
  //  - **STALE `kind`** (blob predates a `kb.updated` that flipped `standard` →
  //    `source`) — the KB stays in the allow-list until the TTL, so a hidden
  //    container's articles remain listable. **Fail-OPEN**, and the only such
  //    direction here. Accepted because `kind` is set at creation by the
  //    KnowledgeSource pipeline and nothing in the product mutates it, and
  //    because `kb.updated` invalidates this key anyway.
  //
  // No `vN` suffix: this is a brand-new prefix, so there is no old writer whose
  // blob a new reader could misread. Bump it the moment `CachedKnowledgeBase`
  // grows a field or a value vocabulary here changes meaning.
  knowledgeBases: { prefix: 'org:knowledge-bases', ttlSeconds: ONE_DAY },

  // AI provider data (15-min TTL)
  aiProviderConfigs: { prefix: 'org:ai-provider-configs', ttlSeconds: 900 },
  aiCredentials: { prefix: 'org:ai-credentials', ttlSeconds: 900 },
  aiDefaultModels: { prefix: 'org:ai-default-models', ttlSeconds: 900 },
}
