// packages/seed/src/scenarios/demo.scenario.ts
// Scenario definition for polished feature demos with narrative data

import type { SeedingScenarioDefinition } from '../types'

/** demoScenario balances realism and clarity for interactive product demos. */
export const demoScenario: SeedingScenarioDefinition = {
  name: 'demo',
  description: 'Narrative-rich data for guided product demonstrations',
  globalCount: 75,
  scales: {
    organizations: 3,
    users: 18,
    customers: 80,
    products: 40,
    orders: 160,
    threads: 22,
    messages: 120,
    tickets: 30,
  },
  features: {
    authentication: true,
    testUsers: true,
    activeSessions: true,
    aiAnalysis: true,
    metrics: true,
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
}
