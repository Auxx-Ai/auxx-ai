// packages/lib/src/ai/agent-framework/__tests__/procedure-resume-persist.test.ts

import { describe, expect, it } from 'vitest'
import { PROCEDURE_SLICE_KEY, readProcedureSlice } from '../../../agents/procedures/persist'
import type { ProcedureStack } from '../../../agents/procedures/types'
import type { ToolCall, UsageMetrics } from '../../clients/base/types'
import { AgentEngine } from '../engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  AgentToolDefinition,
  LLMCallParams,
  LLMStreamEvent,
} from '../types'

/**
 * §2.2 verify — the procedure stack (`domainState.procedure`) survives the
 * approval pause/resume round-trip.
 *
 * A procedure turn that pauses on an approval-required tool persists the stack
 * via the sandwich's `writeProcedureSlice` + the caller's `updateSessionDomainState`.
 * The approval-resume turn then SKIPS the procedure sandwich (`type === 'approval'`
 * in `process-agent-job.ts`) and calls `engine.resume(...)` directly. This pins the
 * two engine-level invariants that make that skip safe:
 *
 *  1. `resume()` never calls `resetTurnDomainState` (only `submitMessage` does,
 *     engine.ts) — so the stack is not even eligible for the reset.
 *  2. `resume()` only shallow-spreads `domainState` and syncs the context (`__context`)
 *     slice — it never reads, writes, or drops the `procedure` key.
 *
 * Result: the stack rides through the round-trip byte-for-byte, so the next fresh
 * customer turn sticky-resumes from it (Phase-1 `selectProcedure`). The
 * `resetTurnDomainState` exemption tested in `kopilot/__tests__/domain-config.test.ts`
 * is belt-and-suspenders for the FRESH-turn path; resume never reaches it.
 */

const ZERO: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

const toolCall = (id: string, name: string): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
})

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<void> {
  for await (const _event of gen) {
    // consume
  }
}

const STACK: ProcedureStack = {
  frames: [
    {
      procedureId: 'proc_1',
      procedureVersionId: 'ver_1',
      cursor: 'step_2',
      status: 'running',
      history: [{ stepId: 'step_1', outcome: 'advanced' }],
      pushedBy: 'selection',
    },
  ],
}

interface ScriptedTurn {
  content: string
  toolCalls?: ToolCall[]
}

function buildEngine(turns: ScriptedTurn[]) {
  let idx = 0
  const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = turns[idx++] ?? { content: '' }
    yield { type: 'done', content: turn.content, toolCalls: turn.toolCalls ?? [], usage: ZERO }
  }

  const writer: AgentToolDefinition = {
    name: 'writer',
    displayName: 'Writer',
    description: 'an approval-gated tool that pauses the turn',
    parameters: { type: 'object', properties: {}, required: [] },
    requiresApproval: true,
    execute: async () => ({ success: true, output: { ok: true } }),
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: [writer],
    buildMessages: async () => [],
    processResult: async (_c, _t, state) => state,
    maxIterations: 5,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'm',
    defaultProvider: 'p',
    // Mirror the real kopilot reset: drop a turn-scoped key on a fresh user
    // message but EXEMPT the procedure slice (domain-config.ts). submitMessage
    // runs this; resume must not.
    resetTurnDomainState: (ds: Record<string, unknown>) => {
      const procedure = ds[PROCEDURE_SLICE_KEY]
      const { __turnScoped, ...rest } = ds
      return procedure !== undefined ? { ...rest, [PROCEDURE_SLICE_KEY]: procedure } : rest
    },
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    db: {} as never,
    domainConfig,
    callModel,
  }

  return new AgentEngine(config, {
    messages: [],
    domainState: { [PROCEDURE_SLICE_KEY]: STACK, __turnScoped: 'turn-only' },
  })
}

describe('procedure stack survives the approval pause/resume round-trip (§2.2)', () => {
  it('keeps domainState.procedure intact while paused for approval', async () => {
    const engine = buildEngine([
      { content: 'working on it', toolCalls: [toolCall('tc_1', 'writer')] },
    ])

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    expect(state.pendingToolCall).toBeDefined() // genuinely paused on the approval
    expect(readProcedureSlice(state.domainState as Record<string, unknown>)).toEqual(STACK)
  })

  it('preserves domainState.procedure across resume(approve) — the skipped sandwich is safe', async () => {
    const engine = buildEngine([
      { content: 'working on it', toolCalls: [toolCall('tc_1', 'writer')] },
      { content: 'all done', toolCalls: [] },
    ])

    await drain(engine.submitMessage('go'))
    // submitMessage ran the reset → the turn key was dropped, the slice exempted.
    expect(engine.getState().domainState.__turnScoped).toBeUndefined()
    expect(readProcedureSlice(engine.getState().domainState as Record<string, unknown>)).toEqual(
      STACK
    )

    await drain(engine.resume({ action: 'approve' }))

    const state = engine.getState()
    expect(state.pendingToolCall).toBeUndefined() // resumed + completed
    // The stack rode through untouched → the next fresh turn sticky-resumes from it.
    expect(readProcedureSlice(state.domainState as Record<string, unknown>)).toEqual(STACK)
  })

  it('resume does NOT run resetTurnDomainState (a turn-scoped key set while paused survives)', async () => {
    const engine = buildEngine([
      { content: 'working on it', toolCalls: [toolCall('tc_1', 'writer')] },
      { content: 'all done', toolCalls: [] },
    ])

    await drain(engine.submitMessage('go'))
    // Re-seed a turn-scoped key WHILE paused. getState() returns the live
    // domainState object (shallow clone), so this mutates engine state. If resume
    // ran the reset, this key would be dropped.
    ;(engine.getState().domainState as Record<string, unknown>).__turnScoped = 'set-while-paused'

    await drain(engine.resume({ action: 'approve' }))

    expect(engine.getState().domainState.__turnScoped).toBe('set-while-paused')
    // ...and the procedure slice is still intact alongside it.
    expect(readProcedureSlice(engine.getState().domainState as Record<string, unknown>)).toEqual(
      STACK
    )
  })

  it('preserves domainState.procedure across resume(reject) too', async () => {
    const engine = buildEngine([
      { content: 'working on it', toolCalls: [toolCall('tc_1', 'writer')] },
      { content: 'okay, skipped it', toolCalls: [] },
    ])

    await drain(engine.submitMessage('go'))
    await drain(engine.resume({ action: 'reject' }))

    const state = engine.getState()
    expect(state.pendingToolCall).toBeUndefined()
    expect(readProcedureSlice(state.domainState as Record<string, unknown>)).toEqual(STACK)
  })
})
