// packages/lib/src/agents/procedures/persist.ts

import type { ProcedureStack } from './types'

/**
 * Durability for the procedure stack — the v9 counterpart to the context store's
 * `__context` slice (`agent-framework/context/context-store.ts`). The
 * {@link ProcedureStack} rides on `domainState` under {@link PROCEDURE_SLICE_KEY}
 * so it round-trips every persist point (chat turn end, job turn end, the
 * approval-pause persist) for free, and survives `resetTurnDomainState` (the
 * reset exemption in `ai/kopilot/domain-config.ts` re-adds it like `vars`).
 *
 * Unlike the context slice there is no separate "serialize" step — the stack is
 * already a plain JSON value (`{ frames: ProcedureFrame[] }`), so the slice IS
 * the stack. See plans/chat/v9/phase-4-wiring.md §2.
 */

/** Key under which the procedure stack rides on `domainState`. */
export const PROCEDURE_SLICE_KEY = 'procedure'

/**
 * Key for the TURN-LOCAL active step the stepper computed this turn. Unlike the
 * stack (cross-turn control state), this is recomputed by `prepareTurn` every
 * turn, so it does NOT need the `resetTurnDomainState` exemption — the turn
 * preamble writes it before the engine drains, and the prompt build (`agent.ts`)
 * reads it back to populate `PromptCtx.procedureStep`. Cleared on a free-form
 * turn so the section drops out (PROCEDURE-STACK #9). Holds a
 * `ProcedureStepInput` (typed in `ai/kopilot/prompts/sections/types.ts`; kept as
 * a bare key here to avoid coupling this module to the prompt layer).
 */
export const PROCEDURE_STEP_KEY = '__proc_step'

/** Narrow an unknown `domainState['procedure']` to a {@link ProcedureStack}. */
function isProcedureStack(value: unknown): value is ProcedureStack {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { frames?: unknown }).frames)
  )
}

/** Read the persisted stack off a `domainState` for the turn preamble. */
export function readProcedureSlice(
  domainState: Record<string, unknown> | undefined
): ProcedureStack | undefined {
  const slice = domainState?.[PROCEDURE_SLICE_KEY]
  return isProcedureStack(slice) ? slice : undefined
}

/**
 * Write the stack back onto `domainState` under {@link PROCEDURE_SLICE_KEY}.
 * Mutates the live `domainState` object so the slice rides into
 * `engine.getState().domainState` and is persisted at the same
 * `updateSessionDomainState` calls the context slice uses — no new persist call.
 */
export function writeProcedureSlice(
  domainState: Record<string, unknown>,
  stack: ProcedureStack
): void {
  domainState[PROCEDURE_SLICE_KEY] = stack
}
