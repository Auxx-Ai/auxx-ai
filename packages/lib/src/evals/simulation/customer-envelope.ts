// packages/lib/src/evals/simulation/customer-envelope.ts
//
// The synthetic trigger context that gives a Simulation run the production
// customer-conversation envelope. Threading it through the shared runtime
// builder renders the `customer_message` trigger block + run-mode banner, and
// `buildEffectiveAgentRuntime` derives `audience: 'customer'` from the kind plus
// `surface` from `payload.channel` (`chat` → plain-text chat surface, else
// `email`) — so the eval's formatting + opacity rules match what production
// chat/email actually run. See plans/evals/sim-fidelity-and-agent-quality-plan.md
// §1.1 and plans/chat/v10/chat-agent-system-prompt.md.

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
