// packages/seed/src/scenarios/screenshot.scenario.ts
// Scenario definition curated for marketing screenshots and demos

import type { SeedingScenarioDefinition } from '../types'

/** screenshotScenario delivers polished data suited for marketing visuals. */
export const screenshotScenario: SeedingScenarioDefinition = {
  name: 'screenshot',
  description: 'Curated data optimized for marketing screenshots',
  globalCount: 100,
  scales: {
    organizations: 1,
    users: 15,
    customers: 100,
    products: 30,
    orders: 100,
    threads: 40,
    messages: 120,
    tickets: 15,
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
    relationships: 'optimized',
    distributions: 'business-ready',
    visualOptimizations: {
      positiveMetrics: true,
      activeConversations: true,
      varietyInData: true,
      professionalContent: true,
    },
  },
}
