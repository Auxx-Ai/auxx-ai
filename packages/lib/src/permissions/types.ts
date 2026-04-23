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
  kopilot = 'kopilot',
  realtimeSync = 'realtimeSync',
  callRecordings = 'callRecordings',

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
  monthlyAiCredits = 'monthlyAiCredits',

  // ── Usage limits (per billing cycle, Soft + Hard) ──
  callRecordingsHoursPerMonthHard = 'callRecordingsHoursPerMonthHard',
  callRecordingsHoursPerMonthSoft = 'callRecordingsHoursPerMonthSoft',
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
  /** True for caps enforced per-operation (e.g. max rows per import), not standing resource counts. Excluded from overage detection. */
  perOperation?: boolean
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
  { key: FeatureKey.kopilot, type: 'boolean', label: 'Kopilot', group: 'AI' },
  { key: FeatureKey.realtimeSync, type: 'boolean', label: 'Real-Time Sync', group: 'Core' },
  {
    key: FeatureKey.callRecordings,
    type: 'boolean',
    label: 'Call Recordings',
    group: 'Communication',
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
    perOperation: true,
  },
  {
    key: FeatureKey.monthlyAiCredits,
    type: 'static',
    label: 'AI Credits',
    description: 'Monthly AI credit pool. Each LLM call deducts credits by its model multiplier.',
    group: 'AI',
    unit: 'credits/mo',
  },

  // ── Usage limits (paired) ──
  {
    key: FeatureKey.callRecordingsHoursPerMonthHard,
    type: 'usage',
    label: 'Recording Hours',
    group: 'Communication',
    metric: 'callRecordingsHours',
    variant: 'hard',
    pairedKey: FeatureKey.callRecordingsHoursPerMonthSoft,
    unit: 'hrs/mo',
  },
  {
    key: FeatureKey.callRecordingsHoursPerMonthSoft,
    type: 'usage',
    label: 'Recording Hours',
    group: 'Communication',
    metric: 'callRecordingsHours',
    variant: 'soft',
    pairedKey: FeatureKey.callRecordingsHoursPerMonthHard,
    unit: 'hrs/mo',
  },

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

/** Parse feature limits JSON from a plan into typed definitions. Returns [] on invalid input. */
export function parseFeatureLimits(limitsJson: unknown): FeatureDefinition[] {
  if (!limitsJson) return []
  try {
    const parsed = typeof limitsJson === 'string' ? JSON.parse(limitsJson) : limitsJson
    return Array.isArray(parsed) ? (parsed as FeatureDefinition[]) : []
  } catch {
    return []
  }
}

/**
 * Look up a numeric feature limit by key from a plan's featureLimits JSON.
 * Returns null when the feature is missing, boolean, or non-numeric.
 */
export function getNumericFeatureLimit(
  limitsJson: unknown,
  key: FeatureKey | string
): number | null {
  const defs = parseFeatureLimits(limitsJson)
  const match = defs.find((d) => d.key === key)
  if (!match) return null
  const limit = match.limit
  if (limit === '+') return -1
  if (typeof limit === 'number') return limit
  return null
}
