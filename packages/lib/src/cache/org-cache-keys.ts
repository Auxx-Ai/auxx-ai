// packages/lib/src/cache/org-cache-keys.ts

import type {
  AgentConfig,
  AgentKind,
  AppAccountBinding,
  CatalogAction,
  CatalogAgentTool,
  CatalogBlock,
  CatalogToolset,
  CatalogTriggerProjection,
  KnowledgeEntry,
  ToolsetEntry,
} from '@auxx/database'
import type {
  CustomFieldEntity,
  OrganizationMemberInfo,
  OrganizationRole,
} from '@auxx/database/types'
import type { CredentialsResponse, ProviderConfiguration } from '../ai/providers/types'
import type { DehydratedOrganization } from '../dehydration/types'
import type { Inbox } from '../inboxes/types'
import type { Overage } from '../permissions/overage-detection-service'
import type { FeatureMapObject } from '../permissions/types'
import type { Resource } from '../resources/registry/types'
import type { SettingValue } from '../settings/types'
import type { CachedChannel } from './providers/channels-provider'
import type { CachedWorkflowApp } from './providers/workflow-apps-provider'

/** Member info cached with joined user data */
export interface OrgMemberInfo extends OrganizationMemberInfo {
  user: {
    id: string
    name: string | null
    email: string | null
    image: string | null
    userType: string
  } | null
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

  // Billing provider routing
  billingProvider: 'stripe' | 'shopify'
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
}

/** Cached AgentTrigger row (JSON-serializable). Mirrors the dispatch-relevant
 * columns from `AgentTrigger`. Fields that change on every fire
 * (`lastFiredAt`, `lastErrorAt`, `lastError`, `updatedAt`) are intentionally
 * omitted so `recordFire`/`recordError` writes never need to bust the cache.
 *
 * When adding new dispatch-relevant columns to the schema, mirror them here. */
export interface CachedAgentTrigger {
  id: string
  kind: 'scheduled' | 'event' | 'app' | 'mention' | 'assignment' | 'dm'
  enabled: boolean
  triggerType: 'created' | 'updated' | 'deleted' | null
  entityDefinitionId: string | null
  eventType: string | null
  triggerAppId: string | null
  triggerAppTriggerId: string | null
  triggerInstallationId: string | null
  triggerConnectionId: string | null
  config: Record<string, unknown> | null
  instructions: Record<string, unknown> | null
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
  createdById: string
  /** `null` while the builder hasn't named the agent yet. */
  name: string | null
  slug: string
  description: string | null
  avatarUrl: string | null
  /** Invocation surface — `'internal'` (default) or `'chat'`. Immutable after creation. */
  kind: AgentKind
  mentionable: boolean
  /** Tiptap doc; empty object when no prompt has been authored. */
  prompt: Record<string, unknown>
  /** Per-agent toolset configuration. Mention-sourced entries are reconciled from the prompt. */
  toolsets: ToolsetEntry[]
  /** Per-agent knowledge access rules. Mention-sourced entries are reconciled from the prompt. */
  knowledge: KnowledgeEntry[]
  /** Per-agent app account bindings keyed by app id (slug). See plans/kopilot/apps/agent-credentials.md §2. */
  appAccounts: Record<string, AppAccountBinding>

  /** Per-agent model override in `provider:model` format; null = inherit. */
  modelId: string | null
  /** ISO string when chat-driven setup completed; null while in setup mode. */
  setupCompletedAt: string | null
  /** ISO string when archived; null when active. */
  archivedAt: string | null
  /** All AgentTrigger rows owned by this agent (active + disabled). Consumers filter. */
  triggers: CachedAgentTrigger[]
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
   * Mirrors `AgentToolDefinition.chatSafe`. Surfaces the tool in the chat-kind
   * agent toolset catalog (the picker filters by it). Absent ⇒ not chat-safe.
   * See plans/chat/v5.
   */
  chatSafe?: boolean
}

/**
 * Cache-side projection of a toolset. Extends the SDK-defined
 * `CatalogToolset` with the fields the agent catalog renderer needs.
 * Third-party rows populate `slug`/`name`/`description`/`iconKey`/
 * `subGroup` and leave the rest `undefined` (the builder falls back
 * to sensible defaults). The synthetic auxx row populates everything.
 */
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
   * Connection definitions split by scope. Either, both, or neither may be
   * present per app. Each entry mirrors `ConnectionDefinitionSummary`
   * (including oauth2Features).
   */
  connectionDefinitions: {
    user?: {
      label: string | null
      global: boolean | null
      connectionType: string
      oauth2Features: Record<string, unknown> | null
    }
    organization?: {
      label: string | null
      global: boolean | null
      connectionType: string
      oauth2Features: Record<string, unknown> | null
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
  workflowBlocks?: CatalogBlock[]
  workflowTriggers?: CatalogTriggerProjection[]
  actions?: CatalogAction[]

  /**
   * Org-scope connection presence + expiry (decision G2 split path).
   * Populated via LEFT JOIN on `WorkflowCredentials WHERE userId IS NULL`.
   * User-scope presence is a per-request direct DB hit.
   */
  orgConnectionPresent: boolean
  orgConnectionExpiresAt: string | null
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
  memberRoleMap: Record<string, OrganizationRole>

  // Business data
  features: FeatureMapObject
  subscription: CachedSubscription | null
  orgProfile: DehydratedOrgProfile
  resources: Resource[]
  customFields: Record<string, CustomFieldEntity[]> // entityDefId → fields
  groups: CachedGroup[] // all entity_group instances
  agents: CachedAgent[] // all Agent rows (active + archived); consumers filter archivedAt
  inboxes: Inbox[]
  channels: CachedChannel[]
  overages: Overage[]
  orgSettings: Record<string, SettingValue> // key → value (org defaults only)
  installedApps: CachedInstalledApp[]
  workflowApps: CachedWorkflowApp[]

  // AI provider data (15-min TTL, invalidated via ai-provider/model events)
  aiProviderConfigs: Record<string, ProviderConfiguration>
  aiCredentials: Record<string, CredentialsResponse>
  aiDefaultModels: Record<string, CachedSystemModelDefault>
}

export type OrgCacheKeyName = keyof OrgCacheDataMap

const ONE_DAY = 60 * 60 * 24
const THIRTY_DAYS = ONE_DAY * 30

/** Key configuration: prefix for Redis keys, TTL, and local-only flag */
export const ORG_CACHE_KEY_CONFIG: Record<
  OrgCacheKeyName,
  { prefix: string; ttlSeconds: number; localOnly?: boolean }
> = {
  // Near-immutable (30-day TTL, invalidated only on create/delete)
  entityDefs: { prefix: 'org:entity-defs', ttlSeconds: THIRTY_DAYS },
  entityDefSlugs: { prefix: 'org:entity-def-slugs', ttlSeconds: THIRTY_DAYS },
  systemUser: { prefix: 'org:system-user', ttlSeconds: THIRTY_DAYS },
  channelProviders: { prefix: 'org:int-providers', ttlSeconds: THIRTY_DAYS },

  // Membership & permissions (24h TTL, invalidated on member events)
  members: { prefix: 'org:members', ttlSeconds: ONE_DAY },
  memberRoleMap: { prefix: 'org:member-roles', ttlSeconds: ONE_DAY },

  // Business data (24h TTL, all invalidated via cache events)
  features: { prefix: 'org:features', ttlSeconds: THIRTY_DAYS },
  subscription: { prefix: 'org:subscription', ttlSeconds: ONE_DAY },
  orgProfile: { prefix: 'org:profile', ttlSeconds: ONE_DAY },
  resources: { prefix: 'org:resources', ttlSeconds: ONE_DAY },
  customFields: { prefix: 'org:custom-fields', ttlSeconds: ONE_DAY },
  groups: { prefix: 'org:groups', ttlSeconds: ONE_DAY },
  agents: { prefix: 'org:agents', ttlSeconds: ONE_DAY },
  inboxes: { prefix: 'org:inboxes', ttlSeconds: ONE_DAY },
  channels: { prefix: 'org:channels', ttlSeconds: ONE_DAY },
  overages: { prefix: 'org:overages', ttlSeconds: 900 },
  orgSettings: { prefix: 'org:settings', ttlSeconds: ONE_DAY },
  // v2: connectionDefinition (singular) → connectionDefinitions (pair). Bump on shape changes.
  installedApps: { prefix: 'org:installed-apps:v2', ttlSeconds: 900 },
  workflowApps: { prefix: 'org:workflow-apps', ttlSeconds: ONE_DAY },

  // AI provider data (15-min TTL)
  aiProviderConfigs: { prefix: 'org:ai-provider-configs', ttlSeconds: 900 },
  aiCredentials: { prefix: 'org:ai-credentials', ttlSeconds: 900 },
  aiDefaultModels: { prefix: 'org:ai-default-models', ttlSeconds: 900 },
}
