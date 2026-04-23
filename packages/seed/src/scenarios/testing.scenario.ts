// packages/seed/src/scenarios/testing.scenario.ts
// Scenario definition optimized for CI and automated tests

import type { SeedingScenarioDefinition } from '../types'

/** testingScenario minimizes data volume for deterministic CI runs. */
export const testingScenario: SeedingScenarioDefinition = {
  name: 'testing',
  description: 'Minimal data footprint suited for CI and fast test runs',
  globalCount: 5,
  scales: {
    organizations: 1,
    users: 5,
    customers: 10,
    companies: 3,
    products: 5,
    orders: 10,
    threads: 4,
    messages: 12,
    tickets: 20,
  },
  features: {
    authentication: true,
    testUsers: true,
    activeSessions: false,
    aiAnalysis: false,
    metrics: false,
  },
  dataQuality: {
    realisticContent: 'low',
    relationships: 'simplified',
    distributions: 'simplified',
  },
}
