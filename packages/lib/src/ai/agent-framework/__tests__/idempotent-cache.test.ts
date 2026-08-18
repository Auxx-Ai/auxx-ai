// packages/lib/src/ai/agent-framework/__tests__/idempotent-cache.test.ts

import { describe, expect, it } from 'vitest'
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
 * The per-turn idempotent cache and its ONE invariant: a write drops it whole.
 *
 * There was no test of this cache at all, and its absence cost a real turn —
 * an agent fixed three fields in a workflow, re-read it to confirm, and was
 * served the pre-fix graph out of the cache for the rest of the turn. It fixed
 * them again, and again, until it hit the iteration cap and returned nothing.
 * The read tools take `{}` args, so their cache key was constant for the whole
 * turn: one answer, replayed forever.
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
  approvalMode?: 'pause' | 'capture'
}) {
  let llmCalls = 0
  const callModel = async function* (_params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[llmCalls++] ?? { content: 'done', toolCalls: [] }
    yield { type: 'done', content: turn.content, toolCalls: turn.toolCalls, usage: ZERO }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: opts.tools,
    buildMessages: async () => [],
    processResult: async (_c, _tc, state) => state,
    maxIterations: 8,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'm',
    defaultProvider: 'p',
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    // biome-ignore lint/suspicious/noExplicitAny: tests don't touch the db handle
    db: {} as any,
    domainConfig,
    callModel,
    ...(opts.approvalMode ? { approvalMode: opts.approvalMode } : {}),
  }

  return new AgentEngine(config)
}

/** A read tool over a mutable value, counting its own executions. */
function makeWorld() {
  const state = { value: 'before' }
  const reads: string[] = []
  let writeCalls = 0

  const readTool: AgentToolDefinition = {
    name: 'get_thing',
    displayName: 'Get thing',
    description: 'Read the thing',
    parameters: { type: 'object', properties: { which: { type: 'string' } } },
    idempotent: true,
    execute: async () => {
      reads.push(state.value)
      return { success: true, output: { value: state.value } }
    },
  }

  const writeTool: AgentToolDefinition = {
    name: 'set_thing',
    displayName: 'Set thing',
    description: 'Write the thing',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      writeCalls += 1
      state.value = 'after'
      return { success: true, output: { ok: true } }
    },
  }

  const failingWriteTool: AgentToolDefinition = {
    name: 'set_thing',
    displayName: 'Set thing',
    description: 'Write the thing, badly',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      writeCalls += 1
      // A failed write may still have partially landed — the cache must drop.
      state.value = 'after'
      return { success: false, output: null, error: 'boom' }
    },
  }

  return {
    readTool,
    writeTool,
    failingWriteTool,
    reads,
    getWriteCalls: () => writeCalls,
  }
}

describe('per-turn idempotent tool cache', () => {
  it('serves an identical read from cache when nothing has written', async () => {
    const world = makeWorld()
    const engine = buildEngine({
      tools: [world.readTool],
      turns: [
        { content: '', toolCalls: [makeToolCall('c1', 'get_thing')] },
        { content: '', toolCalls: [makeToolCall('c2', 'get_thing')] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    expect(world.reads).toEqual(['before'])
  })

  it('re-executes a read that FOLLOWS a write (read → write → read)', async () => {
    const world = makeWorld()
    const engine = buildEngine({
      tools: [world.readTool, world.writeTool],
      turns: [
        { content: '', toolCalls: [makeToolCall('c1', 'get_thing')] },
        { content: '', toolCalls: [makeToolCall('c2', 'set_thing')] },
        { content: '', toolCalls: [makeToolCall('c3', 'get_thing')] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    expect(world.reads).toEqual(['before', 'after'])
  })

  it('invalidates WITHIN one batch — [read, write, read] in a single iteration', async () => {
    // The exact shape of the logged failure: the model batched its edits and
    // the validate call that checked them into one tool-call array.
    const world = makeWorld()
    const engine = buildEngine({
      tools: [world.readTool, world.writeTool],
      turns: [
        {
          content: '',
          toolCalls: [
            makeToolCall('c1', 'get_thing'),
            makeToolCall('c2', 'set_thing'),
            makeToolCall('c3', 'get_thing'),
          ],
        },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    expect(world.reads).toEqual(['before', 'after'])
  })

  it('drops the cache even when the write FAILED', async () => {
    const world = makeWorld()
    const engine = buildEngine({
      tools: [world.readTool, world.failingWriteTool],
      turns: [
        { content: '', toolCalls: [makeToolCall('c1', 'get_thing')] },
        { content: '', toolCalls: [makeToolCall('c2', 'set_thing')] },
        { content: '', toolCalls: [makeToolCall('c3', 'get_thing')] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    expect(world.reads).toEqual(['before', 'after'])
  })

  it('keys on args — different args never serve each other', async () => {
    const world = makeWorld()
    const engine = buildEngine({
      tools: [world.readTool],
      turns: [
        { content: '', toolCalls: [makeToolCall('c1', 'get_thing', { which: 'a' })] },
        { content: '', toolCalls: [makeToolCall('c2', 'get_thing', { which: 'b' })] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    expect(world.reads).toEqual(['before', 'before'])
  })

  it('applies the same invalidation in capture mode', async () => {
    const world = makeWorld()
    const engine = buildEngine({
      approvalMode: 'capture',
      tools: [world.readTool, world.writeTool],
      turns: [
        { content: '', toolCalls: [makeToolCall('c1', 'get_thing')] },
        { content: '', toolCalls: [makeToolCall('c2', 'set_thing')] },
        { content: '', toolCalls: [makeToolCall('c3', 'get_thing')] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    expect(world.reads).toEqual(['before', 'after'])
  })
})
