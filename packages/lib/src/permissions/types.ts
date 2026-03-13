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
  knowledgeBaseMultiple = 'knowledgeBaseMultiple',
  apiAccess = 'apiAccess',
  customFields = 'customFields',
  workflows = 'workflows',
  aiAgent = 'aiAgent',
  sso = 'sso',

  // ── Static limits (count of things, not time-based) ──
  teammates = 'teammates',
  channels = 'channels',
  rules = 'rules',
  savedViews = 'savedViews',
  kbPublishedArticles = 'kbPublishedArticles',

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
}

/**
 * Represents the default features for a free plan or when no subscription exists.
 */
export const DEFAULT_FREE_PLAN_FEATURES: FeatureDefinition[] = [
  { key: FeatureKey.teammates, limit: 1 },
  { key: FeatureKey.channels, limit: 1 },
  { key: FeatureKey.rules, limit: 1 },
  { key: FeatureKey.savedViews, limit: 5 },
  { key: FeatureKey.knowledgeBase, limit: false },
  { key: FeatureKey.kbPublishedArticles, limit: 0 },
  { key: FeatureKey.apiAccess, limit: false },
  { key: FeatureKey.workflows, limit: false },
  { key: FeatureKey.aiAgent, limit: false },
  { key: FeatureKey.sso, limit: false },
  { key: FeatureKey.customFields, limit: false },
  { key: FeatureKey.outboundEmailsPerMonthHard, limit: 100 },
  { key: FeatureKey.outboundEmailsPerMonthSoft, limit: 80 },
  { key: FeatureKey.workflowRunsPerMonthHard, limit: 0 },
  { key: FeatureKey.aiCompletionsPerMonthHard, limit: 50 },
  { key: FeatureKey.aiCompletionsPerMonthSoft, limit: 40 },
  { key: FeatureKey.apiCallsPerMonthHard, limit: 0 },
  { key: FeatureKey.storageGbHard, limit: 1 },
]
