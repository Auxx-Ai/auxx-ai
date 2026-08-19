// packages/lib/src/ai/agent-framework/__tests__/identical-call-budget.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { ToolCall, UsageMetrics } from '../../clients/base/types'
import { AgentEngine } from '../engine'
import type {
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  AgentToolDefinition,
  AssistantSessionMessage,
  LLMCallParams,
  LLMStreamEvent,
  ToolCallPart,
} from '../types'

/**
 * Turn-wide identical-call budget — the guard that fires where the two streak
 * guards structurally cannot: it counts one exact (name, args) call across the
 * WHOLE turn regardless of outcome, so an interleaved succeeding tool cannot
 * reset it. At the budget the call is answered with a synthetic notice and the
 * turn CONTINUES (contrast the same-tool failure streak, which ends it).
 */

const ZERO: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

const makeToolCall = (id: string, name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

interface ScriptedTurn {
  content: string
  toolCalls: ToolCall[]
}

function buildEngine(opts: {
  turns: ScriptedTurn[]
  tools: AgentToolDefinition[]
  onToolResult?: AgentDomainConfig['onToolResult']
}) {
  let llmCalls = 0
  const callModel = async function* (_params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[llmCalls++] ?? { content: '', toolCalls: [] }
    yield { type: 'done', content: turn.content, toolCalls: turn.toolCalls, usage: ZERO }
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: {
      agent: {
        name: 'agent',
        tools: opts.tools,
        buildMessages: async () => [],
        processResult: async (_c, _tc, state) => state,
        maxIterations: 20,
      },
    },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'm',
    defaultProvider: 'p',
    ...(opts.onToolResult ? { onToolResult: opts.onToolResult } : {}),
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    // biome-ignore lint/suspicious/noExplicitAny: tests don't touch the db handle
    db: {} as any,
    domainConfig,
    callModel,
  }

  return { engine: new AgentEngine(config), getLlmCalls: () => llmCalls }
}

function toolParts(messages: Array<{ role: string }>): ToolCallPart[] {
  const out: ToolCallPart[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const p of (msg as AssistantSessionMessage).parts ?? []) {
      if (p.type === 'tool_call') out.push(p)
    }
  }
  return out
}

const noteOf = (part: ToolCallPart | undefined): string =>
  ((part?.output as { note?: string } | undefined)?.note ?? '') as string

/** A read tool whose answer never changes — the production `list_app_blocks` shape. */
function searchTool(overrides?: Partial<AgentToolDefinition>) {
  const execute = vi.fn(
    (overrides?.execute as AgentToolDefinition['execute']) ??
      (async () => ({ success: true, output: { blocks: [] } }))
  )
  const tool: AgentToolDefinition = {
    name: 'list_app_blocks',
    displayName: 'List app blocks',
    description: 'Search installed app blocks',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    ...overrides,
    execute,
  }
  return { tool, execute }
}

function otherTool() {
  const execute = vi.fn(async () => ({ success: true, output: { ok: true } }))
  const tool: AgentToolDefinition = {
    name: 'get_workflow',
    displayName: 'Get workflow',
    description: 'Read the graph',
    parameters: { type: 'object', properties: {} },
    execute,
  }
  return { tool, execute }
}

describe('turn-wide identical-call budget', () => {
  it('answers the 4th identical call with a synthetic notice and lets the turn continue', async () => {
    const { tool, execute } = searchTool()
    // No assistant text: keeps the identical-args SUCCESS streak (which needs
    // text) out of it, so what fires here is unambiguously the budget.
    const repeat: ScriptedTurn = {
      content: '',
      toolCalls: [makeToolCall('c', 'list_app_blocks', { query: 'ups' })],
    }
    const { engine, getLlmCalls } = buildEngine({
      turns: [repeat, repeat, repeat, repeat, repeat, { content: 'Done.', toolCalls: [] }],
      tools: [tool],
    })

    const events = await drain(engine.submitMessage('go'))

    // Three dispatches, then the tool is never run again this turn.
    expect(execute).toHaveBeenCalledTimes(3)
    // The turn was NOT killed — it ran on and finished normally.
    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)
    expect(getLlmCalls()).toBe(6)

    const parts = toolParts(engine.getState().messages)
    expect(parts).toHaveLength(5)
    // The blocked calls are completed (not failed) and carry the notice.
    for (const idx of [3, 4]) {
      expect(parts[idx]?.status).toBe('completed')
      expect(noteOf(parts[idx])).toContain(
        'You have already called `list_app_blocks` with these exact arguments 3 times'
      )
    }
    // The blocked call still gets a completed event on the stream.
    const completed = events.filter((e) => e.type === 'tool-call-completed')
    expect(completed).toHaveLength(5)
  })

  it('never fires for differing args (a poll loop with a moving cursor)', async () => {
    const { tool, execute } = searchTool()
    const turns: ScriptedTurn[] = [1, 2, 3, 4, 5, 6].map((i) => ({
      content: '',
      toolCalls: [makeToolCall(`c${i}`, 'list_app_blocks', { cursor: i })],
    }))
    const { engine } = buildEngine({
      turns: [...turns, { content: 'done', toolCalls: [] }],
      tools: [tool],
    })

    const events = await drain(engine.submitMessage('go'))

    expect(execute).toHaveBeenCalledTimes(6)
    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
    const parts = toolParts(engine.getState().messages)
    expect(parts.every((p) => p.status === 'completed')).toBe(true)
    expect(parts.every((p) => noteOf(p) === '')).toBe(true)
  })

  it('a retry after fixing a validation error is not counted against the repeat', async () => {
    const { tool, execute } = searchTool({
      validateInputs: async (args) =>
        args.query ? { ok: true, args } : { ok: false, error: 'query is required', args },
    })
    const bad: ScriptedTurn = { content: '', toolCalls: [makeToolCall('c', 'list_app_blocks', {})] }
    const good: ScriptedTurn = {
      content: '',
      toolCalls: [makeToolCall('c', 'list_app_blocks', { query: 'ups' })],
    }
    const { engine } = buildEngine({
      turns: [bad, bad, good, good, good, { content: 'done', toolCalls: [] }],
      tools: [tool],
    })

    const events = await drain(engine.submitMessage('go'))

    // The two rejected attempts never reached `execute`, and — crucially —
    // never spent the fixed call's budget: all three good calls dispatched.
    expect(execute).toHaveBeenCalledTimes(3)
    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
  })

  it('an interleaved SUCCEEDING tool does not reset the counter (the hole in the streak guards)', async () => {
    // Exactly the production shape: a failing search, then a different tool
    // that succeeds, over and over. Both streak guards reset on every other
    // iteration and never fire; the budget counts straight through.
    const { tool: search, execute: searchExec } = searchTool({
      execute: async () => ({
        success: false,
        output: null,
        error: 'No installed app contributes a matching block',
      }),
    })
    const { tool: other, execute: otherExec } = otherTool()

    const searchTurn: ScriptedTurn = {
      content: '',
      toolCalls: [makeToolCall('s', 'list_app_blocks', { query: 'ups' })],
    }
    const otherTurn: ScriptedTurn = {
      content: '',
      toolCalls: [makeToolCall('o', 'get_workflow', {})],
    }

    const { engine } = buildEngine({
      turns: [
        searchTurn,
        otherTurn,
        searchTurn,
        otherTurn,
        searchTurn,
        otherTurn,
        searchTurn, // 4th identical search — blocked
        { content: 'Answering from what I have.', toolCalls: [] },
      ],
      tools: [search, other],
    })

    const events = await drain(engine.submitMessage('go'))

    // The interleaved successes reset both streaks, so neither guard fired…
    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
    // …and the budget still stopped the 4th identical search from running.
    expect(searchExec).toHaveBeenCalledTimes(3)
    // `get_workflow` has distinct-enough call ledger entries of its own — it
    // ran three times with identical args, all within budget.
    expect(otherExec).toHaveBeenCalledTimes(3)

    const parts = toolParts(engine.getState().messages)
    const blocked = parts[6]
    expect(blocked?.name).toBe('list_app_blocks')
    expect(blocked?.status).toBe('completed')
    expect(noteOf(blocked)).toContain('It will not change')
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)
  })

  it('keeps the synthetic notice out of the domain onToolResult hook', async () => {
    const { tool } = searchTool()
    const onToolResult = vi.fn((_name, _result, state) => state)
    const repeat: ScriptedTurn = {
      content: '',
      toolCalls: [makeToolCall('c', 'list_app_blocks', { query: 'ups' })],
    }
    const { engine } = buildEngine({
      turns: [repeat, repeat, repeat, repeat, { content: 'done', toolCalls: [] }],
      tools: [tool],
      onToolResult,
    })

    await drain(engine.submitMessage('go'))

    // Three real results were mined; the 4th (synthetic) was not.
    expect(onToolResult).toHaveBeenCalledTimes(3)
  })
})

describe('the existing streak guards are unchanged by the budget', () => {
  it('SAME_TOOL_FAILURE_LIMIT still ends the turn with a turn-error', async () => {
    const { tool, execute } = searchTool({
      execute: async () => ({ success: false, output: null, error: 'boom' }),
    })
    const failing: ScriptedTurn = {
      content: '',
      toolCalls: [makeToolCall('c', 'list_app_blocks', { query: 'ups' })],
    }
    const { engine } = buildEngine({
      turns: [failing, failing, failing, { content: 'SHOULD NOT RUN', toolCalls: [] }],
      tools: [tool],
    })

    const events = await drain(engine.submitMessage('go'))

    // The failure streak trips on the 3rd dispatch — before the budget could
    // ever block a 4th — and still aborts.
    expect(execute).toHaveBeenCalledTimes(3)
    const turnError = events.find((e) => e.type === 'turn-error')
    expect(turnError).toBeDefined()
    expect((turnError as { error: string }).error).toContain('failed 3 times in a row')
  })

  it('SAME_TOOL_SUCCESS_LIMIT still finalizes gracefully on identical-args + text', async () => {
    const { tool, execute } = searchTool()
    const repeat: ScriptedTurn = {
      content: 'Wrapped up!',
      toolCalls: [makeToolCall('c', 'list_app_blocks', { query: 'ups' })],
    }
    const { engine, getLlmCalls } = buildEngine({
      turns: [repeat, repeat, repeat, { content: 'SHOULD NOT RUN', toolCalls: [] }],
      tools: [tool],
    })

    const events = await drain(engine.submitMessage('go'))

    expect(getLlmCalls()).toBe(3)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)
  })
})
