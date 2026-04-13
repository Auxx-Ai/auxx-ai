// packages/seed/src/scenarios/demo.scenario.ts
// Scenario definition for polished feature demos with narrative data

import type { SeedingScenarioDefinition } from '../types'

/** demoScenario balances realism and clarity for interactive product demos. */
export const demoScenario: SeedingScenarioDefinition = {
  name: 'demo',
  description: 'Lightweight data for instant demo experience',
  globalCount: 20,
  scales: {
    organizations: 1,
    users: 2,
    customers: 15,
    products: 0,
    orders: 0,
    threads: 50,
    messages: 200,
    tickets: 30,
    datasets: 1,
  },
  features: {
    authentication: true,
    testUsers: true,
    activeSessions: true,
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
}
