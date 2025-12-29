// packages/seed/src/scenarios/performance.scenario.ts
// Scenario definition that exercises the platform with large datasets

import type { SeedingScenarioDefinition } from '../types'

/** performanceScenario scales entity counts for load testing and benchmarking. */
export const performanceScenario: SeedingScenarioDefinition = {
  name: 'performance',
  description: 'Large datasets for performance testing and load analysis',
  globalCount: 10000,
  scales: {
    organizations: 50,
    users: 5000,
    customers: 50000,
    products: 10000,
    orders: 500000,
    threads: 100000,
    messages: 2000000,
    tickets: 1000,
  },
  features: {
    authentication: true,
    testUsers: true,
    activeSessions: false,
    aiAnalysis: true,
    metrics: true,
    indexOptimization: true,
  },
  dataQuality: {
    realisticContent: 'low',
    relationships: 'standard',
    distributions: 'realistic',
  },
  performance: {
    batchSize: 10000,
    parallelProcessing: true,
    memoryOptimized: true,
  },
}
