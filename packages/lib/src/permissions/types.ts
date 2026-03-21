// packages/lib/src/permissions/types.ts
/**
 * Defines the possible limits for a feature.
 * '+' indicates unlimited access.
 * number indicates a specific numeric limit.
 * boolean indicates simple on/off access (true = on, false = off).
 */
export type FeatureLimit = number | '+' | boolean

/**
 * Structure for defining a feature within the Plan.features JSON array.
 */
export interface FeatureDefinition {
  key: string // Should correspond to a value in FeatureKey
  limit: FeatureLimit
}

/**
 * Type for the feature map object returned by tRPC (JSON serializable).
 */
export type FeatureMapObject = Record<string, FeatureLimit> | null

/**
 * Feature keys follow camelCase naming conventions:
 * - Boolean gates: descriptiveName → true/false
 * - Static limits: descriptiveName → number
 * - Usage limits: namePerMonth{Soft|Hard} → number (-1 = unlimited → normalized to '+')
 */
export enum FeatureKey {
  // ── Boolean gates (on/off) ──
  knowledgeBase = 'knowledgeBase',
  apiAccess = 'apiAccess',
  workflows = 'workflows',
  aiAgent = 'aiAgent',
  sso = 'sso',
  datasets = 'datasets',
  files = 'files',
  webhooks = 'webhooks',
  shopify = 'shopify',
  devTools = 'devTools',
  unverifiedApps = 'unverifiedApps',

  // ── Static limits (count of things, not time-based) ──
  teammates = 'teammates',
  channels = 'channels',
  workflowsLimit = 'workflowsLimit',
  savedViews = 'savedViews',
  kbPublishedArticles = 'kbPublishedArticles',
  knowledgeBases = 'knowledgeBases',
  datasetsLimit = 'datasetsLimit',
  entities = 'entities',
  importRowsLimit = 'importRowsLimit',

  // ── Usage limits (per billing cycle, Soft + Hard) ──
  outboundEmailsPerMonthHard = 'outboundEmailsPerMonthHard',
  outboundEmailsPerMonthSoft = 'outboundEmailsPerMonthSoft',
  workflowRunsPerMonthHard = 'workflowRunsPerMonthHard',
  workflowRunsPerMonthSoft = 'workflowRunsPerMonthSoft',
  aiCompletionsPerMonthHard = 'aiCompletionsPerMonthHard',
  aiCompletionsPerMonthSoft = 'aiCompletionsPerMonthSoft',
  apiCallsPerMonthHard = 'apiCallsPerMonthHard',
  apiCallsPerMonthSoft = 'apiCallsPerMonthSoft',
  storageGbHard = 'storageGbHard',
  storageGbSoft = 'storageGbSoft',

  // ── Velocity limits (per minute, enforced via RedisRateLimiter) ──
  appMutationsPerMinuteHard = 'appMutationsPerMinuteHard',
  appMutationsPerMinuteSoft = 'appMutationsPerMinuteSoft',
}

// ── Feature metadata registry ──

export type FeatureType = 'boolean' | 'static' | 'usage'

export interface FeatureMetadata {
  key: FeatureKey
  type: FeatureType
  label: string
  description?: string
  /** Group name for UI sectioning */
  group: string
  /** For usage limits: the base metric name (e.g., 'outboundEmails') */
  metric?: string
  /** For usage limits: whether this is the soft or hard variant */
  variant?: 'hard' | 'soft'
  /** For usage limits: the paired soft/hard key */
  pairedKey?: FeatureKey
  /** Unit label for display (e.g., 'emails', 'GB', 'runs') */
  unit?: string
}

/** Single source of truth for all feature keys, their types, labels, and grouping. */
export const FEATURE_REGISTRY: FeatureMetadata[] = [
  // ── Boolean gates ──
  {
    key: FeatureKey.knowledgeBase,
    type: 'boolean',
    label: 'Knowledge Base',
    group: 'Knowledge Base',
  },
  { key: FeatureKey.apiAccess, type: 'boolean', label: 'API Access', group: 'Integrations' },
  { key: FeatureKey.workflows, type: 'boolean', label: 'Workflows', group: 'Automation' },
  { key: FeatureKey.aiAgent, type: 'boolean', label: 'AI Agent', group: 'AI' },
  { key: FeatureKey.sso, type: 'boolean', label: 'SSO', group: 'Security' },
  { key: FeatureKey.datasets, type: 'boolean', label: 'Datasets', group: 'Data' },
  { key: FeatureKey.files, type: 'boolean', label: 'Files', group: 'Storage' },
  { key: FeatureKey.webhooks, type: 'boolean', label: 'Webhooks', group: 'Integrations' },
  { key: FeatureKey.shopify, type: 'boolean', label: 'Shopify', group: 'Integrations' },
  { key: FeatureKey.devTools, type: 'boolean', label: 'Dev Tools', group: 'Internal' },
  {
    key: FeatureKey.unverifiedApps,
    type: 'boolean',
    label: 'Unverified Apps',
    description: 'Allow installing unverified apps from the marketplace',
    group: 'Integrations',
  },

  // ── Static limits ──
  { key: FeatureKey.teammates, type: 'static', label: 'Teammates', group: 'Team', unit: 'seats' },
  {
    key: FeatureKey.channels,
    type: 'static',
    label: 'Channels',
    group: 'Communication',
    unit: 'channels',
  },
  {
    key: FeatureKey.workflowsLimit,
    type: 'static',
    label: 'Workflows',
    group: 'Automation',
    unit: 'workflows',
  },
  {
    key: FeatureKey.savedViews,
    type: 'static',
    label: 'Saved Views',
    group: 'Data',
    unit: 'views',
  },
  {
    key: FeatureKey.kbPublishedArticles,
    type: 'static',
    label: 'Published Articles',
    group: 'Knowledge Base',
    unit: 'articles',
  },
  {
    key: FeatureKey.knowledgeBases,
    type: 'static',
    label: 'Knowledge Bases',
    group: 'Knowledge Base',
    unit: 'knowledge bases',
  },
  {
    key: FeatureKey.datasetsLimit,
    type: 'static',
    label: 'Datasets',
    group: 'Data',
    unit: 'datasets',
  },
  {
    key: FeatureKey.entities,
    type: 'static',
    label: 'Custom Entities',
    group: 'Data',
    unit: 'entities',
  },
  {
    key: FeatureKey.importRowsLimit,
    type: 'static',
    label: 'Import Rows',
    group: 'Data',
    unit: 'rows',
  },

  // ── Usage limits (paired) ──
  {
    key: FeatureKey.outboundEmailsPerMonthHard,
    type: 'usage',
    label: 'Outbound Emails',
    group: 'Email',
    metric: 'outboundEmails',
    variant: 'hard',
    pairedKey: FeatureKey.outboundEmailsPerMonthSoft,
    unit: 'emails/mo',
  },
  {
    key: FeatureKey.outboundEmailsPerMonthSoft,
    type: 'usage',
    label: 'Outbound Emails',
    group: 'Email',
    metric: 'outboundEmails',
    variant: 'soft',
    pairedKey: FeatureKey.outboundEmailsPerMonthHard,
    unit: 'emails/mo',
  },

  {
    key: FeatureKey.workflowRunsPerMonthHard,
    type: 'usage',
    label: 'Workflow Runs',
    group: 'Automation',
    metric: 'workflowRuns',
    variant: 'hard',
    pairedKey: FeatureKey.workflowRunsPerMonthSoft,
    unit: 'runs/mo',
  },
  {
    key: FeatureKey.workflowRunsPerMonthSoft,
    type: 'usage',
    label: 'Workflow Runs',
    group: 'Automation',
    metric: 'workflowRuns',
    variant: 'soft',
    pairedKey: FeatureKey.workflowRunsPerMonthHard,
    unit: 'runs/mo',
  },

  {
    key: FeatureKey.aiCompletionsPerMonthHard,
    type: 'usage',
    label: 'AI Completions',
    group: 'AI',
    metric: 'aiCompletions',
    variant: 'hard',
    pairedKey: FeatureKey.aiCompletionsPerMonthSoft,
    unit: 'requests/mo',
  },
  {
    key: FeatureKey.aiCompletionsPerMonthSoft,
    type: 'usage',
    label: 'AI Completions',
    group: 'AI',
    metric: 'aiCompletions',
    variant: 'soft',
    pairedKey: FeatureKey.aiCompletionsPerMonthHard,
    unit: 'requests/mo',
  },

  {
    key: FeatureKey.apiCallsPerMonthHard,
    type: 'usage',
    label: 'API Calls',
    group: 'Integrations',
    metric: 'apiCalls',
    variant: 'hard',
    pairedKey: FeatureKey.apiCallsPerMonthSoft,
    unit: 'calls/mo',
  },
  {
    key: FeatureKey.apiCallsPerMonthSoft,
    type: 'usage',
    label: 'API Calls',
    group: 'Integrations',
    metric: 'apiCalls',
    variant: 'soft',
    pairedKey: FeatureKey.apiCallsPerMonthHard,
    unit: 'calls/mo',
  },

  {
    key: FeatureKey.storageGbHard,
    type: 'usage',
    label: 'Storage',
    group: 'Storage',
    metric: 'storageGb',
    variant: 'hard',
    pairedKey: FeatureKey.storageGbSoft,
    unit: 'GB',
  },
  {
    key: FeatureKey.storageGbSoft,
    type: 'usage',
    label: 'Storage',
    group: 'Storage',
    metric: 'storageGb',
    variant: 'soft',
    pairedKey: FeatureKey.storageGbHard,
    unit: 'GB',
  },

  // ── Velocity limits (per minute) ──
  {
    key: FeatureKey.appMutationsPerMinuteHard,
    type: 'usage',
    label: 'App Mutations',
    group: 'Rate Limits',
    metric: 'appMutations',
    variant: 'hard',
    pairedKey: FeatureKey.appMutationsPerMinuteSoft,
    unit: 'req/min',
  },
  {
    key: FeatureKey.appMutationsPerMinuteSoft,
    type: 'usage',
    label: 'App Mutations',
    group: 'Rate Limits',
    metric: 'appMutations',
    variant: 'soft',
    pairedKey: FeatureKey.appMutationsPerMinuteHard,
    unit: 'req/min',
  },
]

/** Lookup map for quick access */
export const FEATURE_REGISTRY_MAP = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]))

/** Get all unique usage metrics (deduped from hard/soft pairs) */
export const USAGE_METRICS = [
  ...new Set(
    FEATURE_REGISTRY.filter((f) => f.type === 'usage' && f.variant === 'hard').map((f) => f.metric!)
  ),
]

/**
 * Represents the default features for a free plan or when no subscription exists.
 */
export const DEFAULT_FREE_PLAN_FEATURES: FeatureDefinition[] = [
  { key: FeatureKey.teammates, limit: 1 },
  { key: FeatureKey.channels, limit: 3 },
  { key: FeatureKey.workflowsLimit, limit: 5 },
  { key: FeatureKey.savedViews, limit: 5 },
  { key: FeatureKey.knowledgeBase, limit: false },
  { key: FeatureKey.knowledgeBases, limit: 0 },
  { key: FeatureKey.kbPublishedArticles, limit: 0 },
  { key: FeatureKey.apiAccess, limit: false },
  { key: FeatureKey.workflows, limit: false },
  { key: FeatureKey.aiAgent, limit: false },
  { key: FeatureKey.sso, limit: false },
  { key: FeatureKey.entities, limit: 3 },
  { key: FeatureKey.importRowsLimit, limit: 50 },
  { key: FeatureKey.datasets, limit: false },
  { key: FeatureKey.datasetsLimit, limit: 0 },
  { key: FeatureKey.files, limit: false },
  { key: FeatureKey.webhooks, limit: false },
  { key: FeatureKey.shopify, limit: false },
  { key: FeatureKey.devTools, limit: false },
  { key: FeatureKey.unverifiedApps, limit: true },
  { key: FeatureKey.outboundEmailsPerMonthHard, limit: 100 },
  { key: FeatureKey.outboundEmailsPerMonthSoft, limit: 80 },
  { key: FeatureKey.workflowRunsPerMonthHard, limit: 0 },
  { key: FeatureKey.aiCompletionsPerMonthHard, limit: 50 },
  { key: FeatureKey.aiCompletionsPerMonthSoft, limit: 40 },
  { key: FeatureKey.apiCallsPerMonthHard, limit: 0 },
  { key: FeatureKey.storageGbHard, limit: 1 },
  { key: FeatureKey.appMutationsPerMinuteHard, limit: 30 },
  { key: FeatureKey.appMutationsPerMinuteSoft, limit: 25 },
]
