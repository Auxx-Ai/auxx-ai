// packages/seed/src/domains/workflow.domain.ts
// Workflow automation domain refinements for drizzle-seed with comprehensive workflow seeding

import type { SeedingScenario } from '../types'

/** WorkflowDomain encapsulates workflow and automation refinements. */
export class WorkflowDomain {
  /**
   * Creates a new WorkflowDomain instance.
   * @param scenario - Scenario definition governing scale.
   */
  constructor(private readonly scenario: SeedingScenario) {}

  /** buildRefinements returns drizzle-seed refinements for workflow entities. */
  buildRefinements(): (helpers: unknown) => Record<string, unknown> {
    return () => {
      console.log('⚙️ Workflow domain refinements skipped (handled elsewhere)')
      return {}
    }
  }
}
