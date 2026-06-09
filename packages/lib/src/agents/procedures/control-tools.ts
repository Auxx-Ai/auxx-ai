// packages/lib/src/agents/procedures/control-tools.ts

import type { AgentToolDefinition } from '../../ai/agent-framework/types'

/**
 * The control-tool surface — the small set of tools the model calls to signal
 * procedure intent (the instruction step is the ONLY place semantic intent is
 * judged). They don't mutate the stack (it lives in `domainState`, replaced each
 * loop step); each tool **records its signal** into the always-present shared
 * context store under {@link PROC_SIGNAL_KEY}, and the post-turn `interpretSignal`
 * reads + clears it. The natural turn terminal is still "the model replies with no
 * tool call" — a control tool is not a forced stop (there is no `tool_choice`
 * forcing in the loop).
 *
 * These are ordinary {@link AgentToolDefinition}s; **Phase 4** mounts them on the
 * agent only while a frame is active. See plans/chat/v9/phase-3-stepper-and-stack.md §1.
 */

/** Turn-local key the control tools write and `interpretSignal` reads then deletes. */
export const PROC_SIGNAL_KEY = 'var:__proc_signal'

/** The recorded model intent for the post-turn `interpretSignal`. */
export type ProcedureSignal =
  | { kind: 'advance' }
  | { kind: 'await' }
  | { kind: 'digress'; reason: string }
  | { kind: 'handoff' }
  | { kind: 'end' }

const emptyParams = { type: 'object', properties: {}, additionalProperties: false } as const

export const advanceProcedure: AgentToolDefinition = {
  name: 'advance_procedure',
  displayName: 'Advance procedure',
  category: 'control',
  description:
    'Call when THIS step of the procedure is complete and the conversation should move on to the next step.',
  parameters: emptyParams,
  execute: async (_args, ctx) => {
    await ctx.context.write(PROC_SIGNAL_KEY, { kind: 'advance' })
    return { success: true, output: { signal: 'advance' } }
  },
}

export const awaitCustomer: AgentToolDefinition = {
  name: 'await_customer',
  displayName: 'Await customer',
  category: 'control',
  description:
    'Call when you need more information from the customer before this step can complete.',
  parameters: emptyParams,
  execute: async (_args, ctx) => {
    await ctx.context.write(PROC_SIGNAL_KEY, { kind: 'await' })
    return { success: true, output: { signal: 'await' } }
  },
}

export const digress: AgentToolDefinition = {
  name: 'digress',
  displayName: 'Digress',
  category: 'control',
  description:
    'Call when the customer asked for something THIS procedure does not cover. Do NOT answer the side request yourself — signalling routes it.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: { type: 'string', description: 'one line: what the customer asked for' },
    },
  },
  execute: async (args, ctx) => {
    const reason = typeof args.reason === 'string' ? args.reason : ''
    await ctx.context.write(PROC_SIGNAL_KEY, { kind: 'digress', reason })
    // Proactive digress: the model emits no customer text this turn — the routed
    // procedure's first step produces the customer-facing opener same-turn.
    return { success: true, output: { signal: 'digress', acknowledged: true } }
  },
}

export const handoffToHuman: AgentToolDefinition = {
  name: 'handoff_to_human',
  displayName: 'Hand off to a human',
  category: 'control',
  description: 'Call to escalate this conversation to a human agent and stop the procedure.',
  parameters: emptyParams,
  execute: async (_args, ctx) => {
    await ctx.context.write(PROC_SIGNAL_KEY, { kind: 'handoff' })
    return { success: true, output: { signal: 'handoff' } }
  },
}

export const endProcedure: AgentToolDefinition = {
  name: 'end_procedure',
  displayName: 'End procedure',
  category: 'control',
  description:
    'Call when the whole procedure is finished and the conversation should return to where it was before.',
  parameters: emptyParams,
  execute: async (_args, ctx) => {
    await ctx.context.write(PROC_SIGNAL_KEY, { kind: 'end' })
    return { success: true, output: { signal: 'end' } }
  },
}

/** All control tools, for Phase 4 to mount while a frame is active. */
export const PROCEDURE_CONTROL_TOOLS: AgentToolDefinition[] = [
  advanceProcedure,
  awaitCustomer,
  digress,
  handoffToHuman,
  endProcedure,
]
