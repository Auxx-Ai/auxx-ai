// src/types/features.ts
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
 * Enum defining all valid feature keys used across the application.
 * Helps ensure consistency and prevent typos.
 */
export enum FeatureKey {
  TEAMMATES = 'TEAMMATES',
  CHANNELS = 'CHANNELS',
  CHANNELS_SOCIAL = 'CHANNELS_SOCIAL',
  CHANNELS_TWITTER = 'CHANNELS_TWITTER',
  CHANNELS_CHAT = 'CHANNELS_CHAT',
  CHANNELS_EMAIL = 'CHANNELS_EMAIL',
  // Explicit channel types can also be features if needed
  // CHANNEL_EMAIL = "CHANNEL_EMAIL",
  // CHANNEL_SMS = "CHANNEL_SMS",
  // ...etc
  RULES = 'RULES',
  ANSWERS = 'ANSWERS', // Assuming this maps to Response Templates or similar
  INTEGRATIONS = 'INTEGRATIONS',
  // Specific integration categories/types if needed
  // INT_DEFAULT = "INT_DEFAULT",
  // ...etc
  API = 'API',
  PLUGINS = 'PLUGINS',
  KNOWLEDGE_BASE = 'KNOWLEDGE_BASE',
  KNOWLEDGE_BASE_DEPTH = 'KNOWLEDGE_BASE_DEPTH',
  KNOWLEDGE_BASE_PUBLISHED_ARTICLES = 'KNOWLEDGE_BASE_PUBLISHED_ARTICLES',
  KNOWLEDGE_BASE_PUBLISHED_LOCALES = 'KNOWLEDGE_BASE_PUBLISHED_LOCALES',
  KNOWLEDGE_BASE_MULTIPLE = 'KNOWLEDGE_BASE_MULTIPLE',
  CHANNELS_TEAMMATES_RATIO = 'CHANNELS_TEAMMATES_RATIO', // Example of a derived/complex limit
  LINKED_CONVERSATIONS = 'LINKED_CONVERSATIONS',
  SAVED_VIEWS_TEAM = 'SAVED_VIEWS_TEAM', // e.g., limit on team-shared views vs private
  TICKET_IDS = 'TICKET_IDS', // Maybe enable custom ticket IDs?
  TICKET_STATUSES = 'TICKET_STATUSES', // Custom ticket statuses?
}

/**
 * Represents the default features for a free plan or when no subscription exists.
 */
export const DEFAULT_FREE_PLAN_FEATURES: FeatureDefinition[] = [
  { key: FeatureKey.TEAMMATES, limit: 1 },
  { key: FeatureKey.CHANNELS, limit: 1 },
  { key: FeatureKey.RULES, limit: 1 },
  { key: FeatureKey.ANSWERS, limit: 5 },
  { key: FeatureKey.KNOWLEDGE_BASE, limit: false }, // Example: KB disabled on free
  { key: FeatureKey.KNOWLEDGE_BASE_PUBLISHED_ARTICLES, limit: 0 },
  { key: FeatureKey.API, limit: false },
  // Add other features with appropriate free limits or 'false'
]
