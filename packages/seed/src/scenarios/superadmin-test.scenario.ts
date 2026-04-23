// packages/seed/src/scenarios/superadmin-test.scenario.ts
// Scenario definition for heavy test data seeding (10x demo) via super admin panel

import type { SeedingScenarioDefinition } from '../types'

/** superadminTestScenario provides 10x the demo data volume for realistic testing. */
export const superadminTestScenario: SeedingScenarioDefinition = {
  name: 'superadmin-test',
  description: 'Heavy test data for super admin testing (10x demo)',
  globalCount: 200,
  scales: {
    organizations: 1,
    users: 2,
    customers: 150,
    companies: 60,
    products: 20,
    orders: 50,
    threads: 500,
    messages: 2000,
    tickets: 1000,
    datasets: 1,
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
