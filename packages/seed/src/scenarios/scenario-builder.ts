// packages/seed/src/scenarios/scenario-builder.ts
// Scenario builder that resolves scenario definitions and applies CLI scale overrides

import type {
  ScenarioScales,
  SeedingScenario,
  SeedingScenarioDefinition,
  SeedingScenarioName,
} from '../types'
import { demoScenario } from './demo.scenario'
import { developmentScenario } from './development.scenario'
import { exampleScenario } from './example.scenario'
import { performanceScenario } from './performance.scenario'
import { screenshotScenario } from './screenshot.scenario'
import { shopifyReviewScenario } from './shopify-review.scenario'
import { superadminTestScenario } from './superadmin-test.scenario'
import { testingScenario } from './testing.scenario'

/** scenarioMap indexes scenario definitions by name. */
const scenarioMap: Record<SeedingScenarioName, SeedingScenarioDefinition> = {
  development: developmentScenario,
  testing: testingScenario,
  screenshot: screenshotScenario,
  performance: performanceScenario,
  demo: demoScenario,
  example: exampleScenario,
  'shopify-review': shopifyReviewScenario,
  'superadmin-test': superadminTestScenario,
}

/** ScenarioBuilder resolves scenario definitions by name. */
export class ScenarioBuilder {
  /**
   * build resolves a scenario definition and applies scale overrides.
   * @param name - Scenario identifier to resolve.
   * @param overrides - Optional scale overrides supplied via CLI.
   * @returns Resolved scenario.
   */
  static build(name: SeedingScenarioName, overrides?: Partial<ScenarioScales>): SeedingScenario {
    const definition = scenarioMap[name]
    if (!definition) {
      throw new Error(`Unknown seeding scenario: ${name}`)
    }

    const scales = overrides ? { ...definition.scales, ...overrides } : definition.scales

    return { ...definition, scales }
  }
}
