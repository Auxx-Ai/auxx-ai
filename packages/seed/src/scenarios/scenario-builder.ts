// packages/seed/src/scenarios/scenario-builder.ts
// Scenario builder that resolves definitions and prepares drizzle-seed refinements

import type {
  DomainRefinementMap,
  ScenarioScales,
  SeedingContext,
  SeedingScenario,
  SeedingScenarioName,
} from '../types'
import { developmentScenario } from './development.scenario'
import { testingScenario } from './testing.scenario'
import { screenshotScenario } from './screenshot.scenario'
import { performanceScenario } from './performance.scenario'
import { demoScenario } from './demo.scenario'
import { CommerceDomain } from '../domains/commerce.domain'
import { CommunicationDomain } from '../domains/communication.domain'
import { OrganizationDomain } from '../domains/organization.domain'
import { AiDomain } from '../domains/ai.domain'
import { WorkflowDomain } from '../domains/workflow.domain'
import { IdPoolManager } from '../utils/id-pool-manager'
import { RelationalDomainBuilder } from '../builders/relational-domain-builder'

/** RelationalSeedingScenario extends SeedingScenario with multi-phase capabilities. */
export interface RelationalSeedingScenario extends SeedingScenario {
  /** idPoolManager manages foreign key ID pools */
  idPoolManager: IdPoolManager
  /** relationalBuilder creates domain refinements with proper relationships */
  relationalBuilder: RelationalDomainBuilder
  /** buildPhaseRefinements creates refinements for a specific phase */
  buildPhaseRefinements(phase: 1 | 2 | 3 | 4 | 5, context?: SeedingContext): DomainRefinementMap
}

/** scenarioMap indexes scenario definitions by name. */
const scenarioMap: Record<SeedingScenarioName, typeof developmentScenario> = {
  development: developmentScenario,
  testing: testingScenario,
  screenshot: screenshotScenario,
  performance: performanceScenario,
  demo: demoScenario,
}

/** ScenarioBuilder constructs scenario objects with refinement builders. */
export class ScenarioBuilder {
  /**
   * build resolves a scenario definition and attaches refinement builders.
   * @param name - Scenario identifier to resolve.
   * @param overrides - Optional scale overrides supplied via CLI.
   * @returns Scenario with attached buildRefinements method.
   */
  static build(name: SeedingScenarioName, overrides?: Partial<ScenarioScales>): SeedingScenario {
    const definition = scenarioMap[name]
    if (!definition) {
      throw new Error(`Unknown seeding scenario: ${name}`)
    }

    const scales = overrides ? { ...definition.scales, ...overrides } : definition.scales

    const scenario: SeedingScenario = {
      ...definition,
      scales,
      buildRefinements(refinementContext: SeedingContext): DomainRefinementMap {
        const commerce = new CommerceDomain(scenario, refinementContext)
        const communication = new CommunicationDomain(scenario, refinementContext)
        const organization = new OrganizationDomain(scenario)
        const ai = new AiDomain(scenario, refinementContext)
        const workflow = new WorkflowDomain(scenario)

        const builders = [
          commerce.buildRefinements(),
          communication.buildRefinements(),
          organization.buildRefinements(),
          ai.buildRefinements(),
          workflow.buildRefinements(),
        ]

        return (helpers: unknown) =>
          builders.reduce<Record<string, unknown>>((acc, builder) => {
            const result = builder(helpers)
            return { ...acc, ...result }
          }, {})
      },
    }

    return scenario
  }

  /**
   * buildRelational creates a scenario with multi-phase relational seeding capabilities.
   * @param name - Scenario identifier to resolve.
   * @param overrides - Optional scale overrides supplied via CLI.
   * @returns RelationalSeedingScenario with phase-based refinement builders.
   */
  static buildRelational(
    name: SeedingScenarioName,
    overrides?: Partial<ScenarioScales>
  ): RelationalSeedingScenario {
    const baseScenario = this.build(name, overrides)
    const idPoolManager = new IdPoolManager(baseScenario)
    const relationalBuilder = new RelationalDomainBuilder(baseScenario, idPoolManager)

    const relationalScenario: RelationalSeedingScenario = {
      ...baseScenario,
      idPoolManager,
      relationalBuilder,
      buildPhaseRefinements(phase: 1 | 2 | 3 | 4 | 5, context?: SeedingContext): DomainRefinementMap {
        console.log(`🔄 Building Phase ${phase} refinements`)

        switch (phase) {
          case 1:
            // Phase 1: Foundation Entities (User, Session, etc.)
            return relationalBuilder.buildUserRefinements()

          case 2:
            // Phase 2: Organization Foundation (Organization, OrganizationSetting)
            return relationalBuilder.buildOrganizationRefinements()

          case 3:
            // Phase 3: Integration Layer (EmailIntegration, MessageTemplate)
            return relationalBuilder.buildIntegrationRefinements()

          case 4:
            // Phase 4: Business Entities (Thread, Product, Customer)
            return (helpers: unknown) => {
              const commerceRefinements = relationalBuilder.buildCommerceRefinements(context)
              const communicationRefinements = relationalBuilder.buildCommunicationRefinements(context)

              // Merge refinements from both domains
              const commerce = commerceRefinements(helpers)
              const communication = communicationRefinements(helpers)

              return { ...commerce, ...communication }
            }

          case 5:
            // Phase 5: Analytics & Automation (AiUsage, AutoResponseRule)
            return (helpers: unknown) => {
              const aiRefinements = relationalBuilder.buildAiRefinements()
              const workflowRefinements = relationalBuilder.buildWorkflowRefinements()

              // Merge refinements from both domains
              const ai = aiRefinements(helpers)
              const workflow = workflowRefinements(helpers)

              return { ...ai, ...workflow }
            }

          default:
            throw new Error(`Invalid phase: ${phase}. Must be 1, 2, 3, 4, or 5.`)
        }
      },
    }

    return relationalScenario
  }

  /**
   * getPhaseDescription returns a human-readable description of what each phase seeds.
   * @param phase - Phase number to describe.
   * @returns Description of the phase.
   */
  static getPhaseDescription(phase: 1 | 2 | 3 | 4 | 5): string {
    const descriptions = {
      1: 'Foundation Entities (User, Session, Account)',
      2: 'Organization Foundation (Organization, OrganizationSetting)',
      3: 'Integration Layer (EmailIntegration, MessageTemplate)',
      4: 'Business Entities (Thread, Product, Customer)',
      5: 'Analytics & Automation (AiUsage, AutoResponseRule)',
    }

    return descriptions[phase]
  }

  /**
   * getAllPhaseDescriptions returns descriptions for all phases.
   * @returns Map of phase numbers to descriptions.
   */
  static getAllPhaseDescriptions(): Record<number, string> {
    return {
      1: this.getPhaseDescription(1),
      2: this.getPhaseDescription(2),
      3: this.getPhaseDescription(3),
      4: this.getPhaseDescription(4),
      5: this.getPhaseDescription(5),
    }
  }

  /**
   * validatePhaseOrder ensures phases are executed in the correct order.
   * @param requestedPhase - Phase being requested.
   * @param idPoolManager - ID pool manager to check for prerequisites.
   */
  static validatePhaseOrder(requestedPhase: number, idPoolManager: IdPoolManager): void {
    const poolSizes = idPoolManager.getPoolSizes()

    const prerequisites = {
      2: ['User'],
      3: ['User', 'Organization'],
      4: ['User', 'Organization', 'Integration'],
      5: ['User', 'Organization', 'MessageTemplate'],
    }

    if (requestedPhase in prerequisites) {
      const required = prerequisites[requestedPhase as keyof typeof prerequisites]
      const missing = required.filter(pool => !poolSizes[pool] || poolSizes[pool] === 0)

      if (missing.length > 0) {
        throw new Error(
          `Phase ${requestedPhase} requires ${missing.join(', ')} ID pools from previous phases. ` +
          `Run earlier phases first.`
        )
      }
    }
  }
}
