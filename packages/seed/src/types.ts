// packages/seed/src/types.ts
// Shared type definitions for the database seeding system

/** SeedingScenarioName enumerates the supported scenario identifiers. */
export type SeedingScenarioName =
  | 'development'
  | 'testing'
  | 'screenshot'
  | 'performance'
  | 'demo'
  | 'superadmin-test'

/** AuthSeederResult captures authentication entities shared with downstream refinements. */
export interface AuthSeederResult {
  /** testUsers contains curated seeded user records. */
  testUsers: Array<{ id: string; email: string; role?: string }>
  /** randomUsers contains deterministic generated user records. */
  randomUsers: Array<{ id: string; email: string }>
  /** credentials exposes shared login information for local usage. */
  credentials: {
    /** message communicates how to use the shared password. */
    message: string
    /** password stores the shared plaintext credential. */
    password: string
    /** accounts enumerates account credentials by email. */
    accounts: Array<{ email: string; password: string }>
  }
}

/** ServiceIntegratorOrganization describes a provisioned organization reference. */
export interface ServiceIntegratorOrganization {
  /** id stores the organization identifier. */
  id: string
  /** ownerId stores the owner user identifier. */
  ownerId: string
}

/** ServiceIntegratorIntegration describes a provisioned integration reference. */
export interface ServiceIntegratorIntegration {
  /** id stores the integration identifier. */
  id: string
  /** organizationId links the integration to an organization. */
  organizationId: string
}

/** ServiceIntegratorInbox describes a provisioned inbox reference. */
export interface ServiceIntegratorInbox {
  /** id stores the inbox identifier. */
  id: string
  /** organizationId links the inbox to an organization. */
  organizationId: string
}

/** ServiceIntegratorShopifyIntegration describes a provisioned Shopify integration reference. */
export interface ServiceIntegratorShopifyIntegration {
  /** id stores the Shopify integration identifier. */
  id: string
  /** organizationId links the integration to its owning organization. */
  organizationId: string
  /** createdById stores the administrator who created the integration. */
  createdById: string
}

/** ServiceIntegratorResult captures service-level entities shared with refinements. */
export interface ServiceIntegratorResult {
  /** organizations enumerates ensured organizations. */
  organizations: ServiceIntegratorOrganization[]
  /** integrations enumerates ensured messaging integrations. */
  integrations: ServiceIntegratorIntegration[]
  /** inboxes enumerates ensured inboxes. */
  inboxes: ServiceIntegratorInbox[]
  /** shopifyIntegrations enumerates ensured Shopify integrations. */
  shopifyIntegrations: ServiceIntegratorShopifyIntegration[]
}

/** SeedingContext conveys prior seeding outputs for refinement builders. */
export interface SeedingContext {
  /** auth stores authentication seeding outputs. */
  auth: AuthSeederResult
  /** services stores service integration outputs. */
  services: ServiceIntegratorResult
}

/** ScenarioScales describes entity counts that individual domains can rely on. */
export interface ScenarioScales {
  /** organizations captures the desired number of organizations to create. */
  organizations: number
  /** users expresses the number of application users required for the scenario. */
  users: number
  /** customers indicates how many customer records to create. */
  customers: number
  /** products determines the size of the product catalog. */
  products: number
  /** orders represents the volume of orders to generate. */
  orders: number
  /** threads is the amount of support threads to simulate. */
  threads: number
  /** messages specifies the volume of support messages. */
  messages: number
  /** tickets represents the volume of support tickets to generate. */
  tickets: number
  /** datasets indicates how many knowledge base datasets to create. */
  datasets?: number
}

/** ScenarioFeatures toggles optional features for a scenario. */
export interface ScenarioFeatures {
  /** authentication enables seeding auth-related tables. */
  authentication: boolean
  /** testUsers surfaces curated credentialed accounts for QA/dev. */
  testUsers: boolean
  /** activeSessions determines whether to create active auth sessions. */
  activeSessions: boolean
  /** aiAnalysis toggles AI domain data generation. */
  aiAnalysis: boolean
  /** metrics toggles analytics/metrics seeding. */
  metrics: boolean
  /** richContent enables screenshot-ready descriptive content. */
  richContent?: boolean
  /** indexOptimization ensures indexes/optimizations for performance scenario. */
  indexOptimization?: boolean
  /** billingStripeResources toggles creation of Stripe entities during billing seeding. */
  billingStripeResources?: boolean
}

/** ScenarioDataQuality encodes qualitative controls for generated data. */
export interface ScenarioDataQuality {
  /** realisticContent controls how curated generated content should be. */
  realisticContent: 'low' | 'medium' | 'high'
  /** relationships controls the degree of relationship complexity. */
  relationships: 'standard' | 'optimized' | 'simplified' | 'enhanced'
  /** distributions controls how strictly to follow weighted distributions. */
  distributions: 'simplified' | 'business-ready' | 'realistic'
  /** visualOptimizations stores screenshot-specific enhancements. */
  visualOptimizations?: {
    /** positiveMetrics highlights favorable analytics for marketing. */
    positiveMetrics?: boolean
    /** activeConversations ensures open conversations for UI shots. */
    activeConversations?: boolean
    /** varietyInData keeps dashboards visually interesting. */
    varietyInData?: boolean
    /** professionalContent enforces business-appropriate tone. */
    professionalContent?: boolean
  }
}

/** SeedingScenarioDefinition represents the domain-agnostic configuration. */
export interface SeedingScenarioDefinition {
  /** name uniquely identifies the scenario. */
  name: SeedingScenarioName
  /** description documents the purpose of the scenario. */
  description: string
  /** globalCount sets the default count multiplier for drizzle-seed. */
  globalCount: number
  /** scales describes target counts for each domain. */
  scales: ScenarioScales
  /** features toggles optional subsystems. */
  features: ScenarioFeatures
  /** dataQuality captures narrative and realism settings. */
  dataQuality: ScenarioDataQuality
  /** performance optionally stores scenario-specific performance flags. */
  performance?: {
    /** batchSize configures streaming/batch insertion sizing. */
    batchSize: number
    /** parallelProcessing toggles multi-thread seeding. */
    parallelProcessing: boolean
    /** memoryOptimized toggles streaming-friendly behavior. */
    memoryOptimized: boolean
  }
}

/** DomainRefinementMap is the shape expected by drizzle-seed refine operations. */
export type DomainRefinementMap =
  | Record<string, unknown>
  | ((helpers: unknown) => Record<string, unknown>)

/** SeedingScenario extends the base definition with refinement builders. */
export interface SeedingScenario extends SeedingScenarioDefinition {
  /** buildRefinements returns drizzle-seed refinements for the scenario. */
  buildRefinements(context: SeedingContext): DomainRefinementMap
}

/** SeedingConfig describes CLI/runtime configuration for the seeder. */
export interface SeedingConfig {
  /** scenario is the requested scenario identifier. */
  scenario: SeedingScenarioName
  /** reset toggles truncated seeding before population. */
  reset: boolean
  /** validate toggles post-seed validation routines. */
  validate: boolean
  /** progress toggles visual progress output. */
  progress: boolean | 'verbose'
  /** seedValue provides deterministic randomness when set. */
  seedValue?: number
  /** overrides allows ad-hoc scale overrides from CLI flags. */
  overrides?: Partial<ScenarioScales>
  /** billingPlansOnly skips all seeding except billing plans (with Stripe resources). */
  billingPlansOnly?: boolean
  /** organizationId targets seeding to a specific organization. */
  organizationId?: string
  /** preserveBilling skips billing domain to preserve existing subscriptions. */
  preserveBilling?: boolean
}

/** SeedingResult summarizes the outcome of a seeding run. */
export interface SeedingResult {
  /** domains collects per-domain execution metadata. */
  domains: Record<string, unknown>
  /** metrics stores aggregated performance metrics. */
  metrics: {
    /** duration is the wall-clock time in milliseconds. */
    duration: number
    /** entitiesCreated is the total number of entities generated. */
    entitiesCreated: number
    /** scenario captures the executed scenario identifier. */
    scenario: SeedingScenarioName
  }
}
