// packages/seed/src/scenarios/development.scenario.ts
// Scenario definition for local development environments

import type { SeedingScenarioDefinition } from '../types'

/** developmentScenario defines balanced data for day-to-day local development. */
export const developmentScenario: SeedingScenarioDefinition = {
  name: 'development',
  description: 'Quick setup for local development with realistic data',
  globalCount: 50,
  scales: {
    organizations: 1,
    users: 2,
    customers: 2, // Reduced from 5
    products: 2,  // Reduced from 3
    orders: 2,    // Reduced from 5
    threads: 1,   // Reduced from 2
    messages: 2,  // Reduced from 5
    tickets: 5,   // Support tickets for development
  },
  features: {
    authentication: true,
    testUsers: true,
    activeSessions: true,
    aiAnalysis: true,
    metrics: false,
  },
  dataQuality: {
    realisticContent: 'medium',
    relationships: 'standard',
    distributions: 'simplified',
  },
}
