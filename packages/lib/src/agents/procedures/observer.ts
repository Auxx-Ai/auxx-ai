// packages/lib/src/agents/procedures/observer.ts
//
// Optional stepper transition observer. Production never supplies one (the seam
// is a no-op when absent); the eval Simulation executor installs an observer so
// it can derive an EXPLICIT terminal outcome (natural finish vs handoff vs switch)
// and the selected procedure — distinctions the post-turn stack state alone
// cannot make once a transition has been consumed.
//
// See plans/evals/phase-1-agent-simulation.md §1.7 (stepper observer).

/** A deterministic procedure-control transition the stepper emits as it walks the stack. */
export type ProcedureTransitionEvent =
  | {
      type: 'step_entered'
      procedureId: string
      procedureVersionId: string
      stepId: string
    }
  | {
      type: 'routing'
      procedureId: string
      procedureVersionId: string
      stepId: string
      outcome: 'finished' | 'handoff' | 'switch' | 'call'
      /** Target procedure (switch) or sub-procedure (call) id, when applicable. */
      targetId?: string
    }
  | {
      type: 'procedure_finished'
      procedureId: string
      procedureVersionId: string
      reason: 'routing' | 'chain_end' | 'missing_step'
    }

/** Sink for {@link ProcedureTransitionEvent}s. Synchronous + best-effort; never throws. */
export type ProcedureObserver = (event: ProcedureTransitionEvent) => void
