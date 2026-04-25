// packages/seed/src/scenarios/example.scenario.ts
// Scenario definition for small starter data on brand-new real accounts

import type { SeedingScenarioDefinition } from '../types'

/** EXAMPLE_WORKFLOW_TEMPLATE_NAME identifies the public template instantiated for new orgs. */
export const EXAMPLE_WORKFLOW_TEMPLATE_NAME = 'Shopify Order Lookup & Reply'

/**
 * exampleScenario seeds a small, meaningful starter dataset into new real accounts
 * so the product doesn't feel empty on first load. User-visible names get an
 * `[Example]` prefix so the user can spot and clean up seeded rows themselves.
 */
export const exampleScenario: SeedingScenarioDefinition = {
  name: 'example',
  description: 'Small, meaningful starter data for new real accounts',
  globalCount: 8,
  scales: {
    organizations: 1,
    users: 1,
    customers: 15,
    companies: 10,
    products: 0,
    orders: 0,
    threads: 8,
    messages: 28,
    tickets: 5,
    datasets: 0,
    workflows: 1,
  },
  features: {
    authentication: false,
    testUsers: false,
    activeSessions: false,
    aiAnalysis: false,
    metrics: false,
    richContent: true,
  },
  dataQuality: {
    realisticContent: 'high',
    relationships: 'enhanced',
    distributions: 'business-ready',
    visualOptimizations: {
      positiveMetrics: true,
      activeConversations: true,
      varietyInData: true,
      professionalContent: true,
    },
  },
  isExample: true,
}
