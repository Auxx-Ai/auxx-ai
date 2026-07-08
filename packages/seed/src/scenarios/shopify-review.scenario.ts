// packages/seed/src/scenarios/shopify-review.scenario.ts
// Minimal scenario for additively injecting scripted Shopify order-support
// threads into an EXISTING org (e.g. the Shopify app-review reviewer's org) via
// superadmin re-seed. Unlike `example`, this creates no companies, tickets, or
// mock integration — threads land on the org's real, already-connected
// integration so the reviewer can demo the AI-reply workflow on real Mail.

import type { SeedingScenarioDefinition } from '../types'

/** shopifyReviewScenario seeds 8 scripted Shopify order threads (28 messages)
 * and their persona contacts into an existing org, nothing else. */
export const shopifyReviewScenario: SeedingScenarioDefinition = {
  name: 'shopify-review',
  description: 'Shopify order-issue sample threads for app-review orgs',
  globalCount: 8,
  scales: {
    organizations: 1,
    users: 1,
    customers: 8, // one contact per conversation persona
    companies: 0,
    products: 0,
    orders: 0,
    threads: 8,
    messages: 28, // must equal EXAMPLE_CONVERSATIONS' actual total
    tickets: 0,
    datasets: 0,
    workflows: 0,
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
  scriptedConversations: true, // no isExample → no [Example] prefix, no mock integration
}
