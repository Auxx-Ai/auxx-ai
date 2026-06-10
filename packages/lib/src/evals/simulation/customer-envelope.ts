// packages/lib/src/evals/simulation/customer-envelope.ts
//
// The synthetic trigger context that gives a Simulation run the production
// customer-conversation envelope. Threading it through the shared runtime
// builder flips `runMode` to `autonomous` (no caller preamble, no internal
// block catalog) and renders the `customer_message` trigger block + run-mode
// banner — the same prompt shape a real inbound customer message produces.
// See plans/evals/sim-fidelity-and-agent-quality-plan.md §1.1.

import type { TriggerContext } from '../../ai/kopilot/prompts/trigger-context'

export function buildSimulationTriggerContext(args: {
  channel: 'chat' | 'email'
  /** Frozen framework clock (epoch ms); falls back to wall clock. */
  nowMs?: number
}): TriggerContext {
  const firedAt = new Date(args.nowMs ?? Date.now()).toISOString()
  return {
    kind: 'customer_message',
    instructions: null,
    payload: { channel: args.channel, firedAt, simulated: true },
  }
}
