// packages/lib/src/evals/__tests__/suggestions.test.ts

import { err, ok } from 'neverthrow'
import { z } from 'zod'

vi.mock('../../agents/procedures/authoring/queries', () => ({
  getAttachedProcedureDraft: vi.fn(),
}))
vi.mock('../../cache', () => ({
  getCachedAgentById: vi.fn(),
}))
vi.mock('../../ai/agent-framework/effective-runtime', () => ({
  buildEffectiveAgentRuntime: vi.fn(),
}))
vi.mock('../../ai/agent-framework/llm-adapter', () => ({
  createCallModel: vi.fn(),
}))
vi.mock('../queries', () => ({
  listEvalCasesByAgent: vi.fn(),
}))

// Stateful in-memory Redis fake so the draft-hash cache can be exercised.
const redisStore = new Map<string, string>()
const fakeRedis = {
  get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
  setex: vi.fn(async (k: string, _ttl: number, v: string) => {
    redisStore.set(k, v)
    return 'OK'
  }),
}
vi.mock('@auxx/redis', () => ({ getRedisClient: vi.fn(async () => fakeRedis) }))

import { getAttachedProcedureDraft } from '../../agents/procedures/authoring/queries'
import { buildEffectiveAgentRuntime } from '../../ai/agent-framework/effective-runtime'
import type { AgentToolDefinition } from '../../ai/agent-framework/types'
import { getCachedAgentById } from '../../cache'
import { listEvalCasesByAgent } from '../queries'
import type { CallModel } from '../simulation/persona'
import { renderProcedureText, suggestAgentSimulations } from '../suggestions'

const mockedDraft = getAttachedProcedureDraft as unknown as ReturnType<typeof vi.fn>
const mockedAgent = getCachedAgentById as unknown as ReturnType<typeof vi.fn>
const mockedRuntime = buildEffectiveAgentRuntime as unknown as ReturnType<typeof vi.fn>
const mockedCases = listEvalCasesByAgent as unknown as ReturnType<typeof vi.fn>

// A small effective toolset: a tool with a schema + example, a schema-less tool,
// and a control tool (filtered out of the mockEditor projection).
const TOOLS = [
  {
    name: 'get_order',
    displayName: 'Get order',
    description: 'Fetch an order by number',
    outputSchema: z.object({ status: z.string() }),
    exampleOutput: { status: 'shipped' },
  },
  {
    name: 'issue_refund',
    displayName: 'Issue refund',
    description: 'Refund an order',
  },
  // App tool whose registered name doubles the app slug — the shape small models
  // "simplify" back to the toolId tail.
  {
    name: 'shopify_find_shopify_order',
    displayName: 'Find Shopify order',
    description: 'Find an order in Shopify',
    exampleOutput: { id: 'gid://shopify/Order/1' },
  },
  {
    name: 'advance_procedure',
    displayName: 'Advance procedure',
    description: 'control signal',
    category: 'control',
  },
] as unknown as AgentToolDefinition[]

function stubModel(content: string, finishReason?: string): CallModel {
  return async function* () {
    yield {
      type: 'done' as const,
      content,
      toolCalls: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      finishReason,
    }
  }
}

function validItem(over: Record<string, unknown> = {}) {
  return {
    name: 'Happy path',
    rationale: 'exercises step 1',
    openingMessage: 'hi I need help with my order',
    customerContext: 'a frustrated customer',
    channel: 'chat',
    maxCustomerTurns: 3,
    mocks: [],
    assertions: [{ type: 'terminal_outcome', outcome: 'finished' }],
    ...over,
  }
}

function envelope(items: unknown[]): string {
  return JSON.stringify({ suggestions: items })
}

const INPUT = { organizationId: 'org', userId: 'user', agentId: 'agent', procedureId: 'proc' }

function run(content: string | CallModel, finishReason?: string) {
  const callModel = typeof content === 'string' ? stubModel(content, finishReason) : content
  return suggestAgentSimulations({ ...INPUT, callModel })
}

// biome-ignore lint/correctness/useYield: deliberately throws before yielding
const throwingModel: CallModel = async function* () {
  throw new Error('boom')
}

beforeEach(() => {
  redisStore.clear()
  mockedDraft.mockReset()
  mockedAgent.mockReset()
  mockedRuntime.mockReset()
  mockedCases.mockReset()

  mockedDraft.mockResolvedValue(
    ok({
      procedureId: 'proc',
      name: 'Refund policy',
      whenToUse: 'customer wants a refund',
      triggerExamples: [],
      ruleset: [],
      hasUnpublishedChanges: false,
      activeVersionId: 'v1',
      enabled: true,
      draftDoc: { type: 'doc', content: [] },
      draftContentHash: 'hash123',
    })
  )
  mockedAgent.mockResolvedValue({ procedures: [] })
  mockedRuntime.mockResolvedValue({ tools: TOOLS, utilityModel: { provider: 'p', model: 'm' } })
  mockedCases.mockResolvedValue(ok([]))
})

describe('suggestAgentSimulations — call + envelope', () => {
  it('returns validated suggestions with generated ids and the draft hash', async () => {
    const result = await run(envelope([validItem(), validItem({ name: 'Edge case' })]))
    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.draftHash).toBe('hash123')
    expect(value.dropped).toBe(0)
    expect(value.suggestions).toHaveLength(2)
    for (const s of value.suggestions) {
      expect(s.suggestionId).toBeTruthy()
      expect(s.assertions[0]?.id).toBeTruthy()
      expect(s.config.unmatchedToolPolicy).toBe('error')
    }
  })

  it('fails on non-JSON content', async () => {
    const result = await run('not json at all')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('EVAL_SUGGESTION_FAILED')
  })

  it('fails when the model output was truncated (finishReason length)', async () => {
    const result = await run(envelope([validItem()]), 'length')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/truncated/)
  })

  it('fails on empty content', async () => {
    const result = await run('')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('EVAL_SUGGESTION_FAILED')
  })

  it('fails with a cause when the stream throws', async () => {
    const result = await run(throwingModel)
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.code).toBe('EVAL_SUGGESTION_FAILED')
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(Error)
  })

  it('fails when the envelope lacks a suggestions array', async () => {
    const result = await run(JSON.stringify({ foo: 1 }))
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('EVAL_SUGGESTION_FAILED')
  })

  it('slices to 5 when the model returns more', async () => {
    const result = await run(envelope(Array.from({ length: 7 }, () => validItem())))
    const value = result._unsafeUnwrap()
    expect(value.suggestions).toHaveLength(5)
    expect(value.dropped).toBe(0)
  })

  it('returns an empty list (not an error) when the model returns 0 items', async () => {
    const result = await run(envelope([]))
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().suggestions).toHaveLength(0)
  })

  it('surfaces a draft-load failure as EVAL_VALIDATION', async () => {
    mockedDraft.mockResolvedValue(err({ code: 'DB', message: 'PROCEDURE_NOT_ATTACHED' }))
    const result = await run(envelope([validItem()]))
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('EVAL_VALIDATION')
  })
})

describe('suggestAgentSimulations — drop pipeline', () => {
  async function dropCase(bad: unknown) {
    const result = await run(envelope([validItem(), bad]))
    const value = result._unsafeUnwrap()
    expect(value.suggestions).toHaveLength(1)
    expect(value.dropped).toBe(1)
    return value
  }

  it('drops a terminal_outcome missing its outcome', async () => {
    await dropCase(validItem({ assertions: [{ type: 'terminal_outcome' }] }))
  })

  it('drops a stray crm_field assertion type', async () => {
    await dropCase(
      validItem({ assertions: [{ type: 'crm_field', ref: 'x', comparator: { op: 'equals' } }] })
    )
  })

  it('drops an item carrying a stray startingFields key', async () => {
    await dropCase(validItem({ startingFields: [] }))
  })

  it('drops a mock referencing an unknown tool', async () => {
    await dropCase(validItem({ mocks: [{ toolName: 'nope', output: '{}' }] }))
  })

  it('drops a mock referencing a control tool (not in the projection)', async () => {
    await dropCase(validItem({ mocks: [{ toolName: 'advance_procedure', output: '{}' }] }))
  })

  it('drops an unknown tool_called toolName', async () => {
    await dropCase(validItem({ assertions: [{ type: 'tool_called', toolName: 'nope' }] }))
  })

  it('drops a mock whose output is not a JSON string', async () => {
    await dropCase(validItem({ mocks: [{ toolName: 'get_order', output: 'not json' }] }))
  })

  it('drops a mock output that fails the tool output schema', async () => {
    await dropCase(
      validItem({ mocks: [{ toolName: 'get_order', output: JSON.stringify({ status: 123 }) }] })
    )
  })

  it('keeps a mock for a schema-less tool (validation warning only)', async () => {
    const result = await run(
      envelope([
        validItem({ mocks: [{ toolName: 'issue_refund', output: JSON.stringify({ ok: true }) }] }),
      ])
    )
    const value = result._unsafeUnwrap()
    expect(value.suggestions).toHaveLength(1)
    expect(value.dropped).toBe(0)
    expect(value.suggestions[0]?.config.connectorMocks).toHaveLength(1)
  })

  it('dedupes multiple mocks for one tool to the first, parsing the JSON output', async () => {
    const result = await run(
      envelope([
        validItem({
          mocks: [
            { toolName: 'get_order', output: JSON.stringify({ status: 'shipped' }) },
            { toolName: 'get_order', output: JSON.stringify({ status: 'pending' }) },
          ],
        }),
      ])
    )
    const value = result._unsafeUnwrap()
    expect(value.suggestions).toHaveLength(1)
    const mocks = value.suggestions[0]?.config.connectorMocks ?? []
    expect(mocks).toHaveLength(1)
    expect(mocks[0]?.output).toEqual({ status: 'shipped' })
    expect(mocks[0]?.usage).toBe('repeat')
  })

  it('clamps maxCustomerTurns into 1–8', async () => {
    const result = await run(
      envelope([validItem({ maxCustomerTurns: 50 }), validItem({ maxCustomerTurns: 0 })])
    )
    const value = result._unsafeUnwrap()
    expect(value.suggestions.map((s) => s.config.maxCustomerTurns).sort()).toEqual([1, 8])
  })

  it('drops an item with no assertions', async () => {
    await dropCase(validItem({ assertions: [] }))
  })

  it('rescues a mock toolName emitted as the unprefixed tail', async () => {
    const result = await run(
      envelope([
        validItem({
          mocks: [{ toolName: 'find_shopify_order', output: JSON.stringify({ id: 'o1' }) }],
        }),
      ])
    )
    const value = result._unsafeUnwrap()
    expect(value.dropped).toBe(0)
    expect(value.suggestions[0]?.config.connectorMocks[0]?.toolName).toBe(
      'shopify_find_shopify_order'
    )
  })

  it('rescues a tool_called assertion toolName emitted as the unprefixed tail', async () => {
    const result = await run(
      envelope([
        validItem({ assertions: [{ type: 'tool_called', toolName: 'find_shopify_order' }] }),
      ])
    )
    const value = result._unsafeUnwrap()
    expect(value.dropped).toBe(0)
    expect(value.suggestions[0]?.assertions[0]).toMatchObject({
      type: 'tool_called',
      data: { toolName: 'shopify_find_shopify_order' },
    })
  })

  it('drops an ambiguous tail name instead of guessing', async () => {
    // Both get_order and shopify_find_shopify_order end with `_order`.
    await dropCase(validItem({ mocks: [{ toolName: 'order', output: '{}' }] }))
  })
})

describe('suggestAgentSimulations — draft-hash cache', () => {
  it('serves a second call from cache without re-invoking the model', async () => {
    const first = await run(envelope([validItem()]))
    expect(first._unsafeUnwrap().suggestions).toHaveLength(1)

    // A model that throws if called — proves the cached result was served.
    const second = await suggestAgentSimulations({ ...INPUT, callModel: throwingModel })
    expect(second.isOk()).toBe(true)
    expect(second._unsafeUnwrap()).toEqual(first._unsafeUnwrap())
  })

  it('force bypasses the cache and regenerates', async () => {
    await run(envelope([validItem({ name: 'Cached' })]))
    const refreshed = await suggestAgentSimulations({
      ...INPUT,
      force: true,
      callModel: stubModel(envelope([validItem({ name: 'A' }), validItem({ name: 'B' })])),
    })
    expect(refreshed._unsafeUnwrap().suggestions).toHaveLength(2)
  })

  it('does not cache a fully-dropped generation', async () => {
    const first = await run(envelope([validItem({ mocks: [{ toolName: 'nope', output: '{}' }] })]))
    expect(first._unsafeUnwrap()).toMatchObject({ suggestions: [], dropped: 1 })

    // The next call must re-invoke the model, not serve the empty result.
    const second = await run(envelope([validItem()]))
    expect(second._unsafeUnwrap().suggestions).toHaveLength(1)
  })

  it('regenerates when the draft hash changes (new cache key)', async () => {
    await run(envelope([validItem()]))
    mockedDraft.mockResolvedValue(
      ok({
        procedureId: 'proc',
        name: 'Refund policy',
        whenToUse: 'customer wants a refund',
        triggerExamples: [],
        ruleset: [],
        hasUnpublishedChanges: false,
        activeVersionId: 'v1',
        enabled: true,
        draftDoc: { type: 'doc', content: [] },
        draftContentHash: 'hash999',
      })
    )
    const next = await suggestAgentSimulations({
      ...INPUT,
      callModel: stubModel(envelope([validItem(), validItem()])),
    })
    expect(next._unsafeUnwrap().draftHash).toBe('hash999')
    expect(next._unsafeUnwrap().suggestions).toHaveLength(2)
  })
})

describe('renderProcedureText', () => {
  it('renders the header, steps, conditions, routes, calls, opaque, and sub-procedures', () => {
    const longText = 'x'.repeat(600)
    const dsl = {
      steps: [
        { id: 's1', kind: 'instruction' as const, text: longText },
        {
          id: 'c1',
          kind: 'condition' as const,
          cases: [
            {
              id: 'ca1',
              when: 'the order has shipped',
              steps: [{ id: 'a1', kind: 'route' as const, outcome: 'finished' as const }],
            },
          ],
          else: [{ id: 'e1', kind: 'route' as const, outcome: 'handoff' as const }],
        },
        {
          id: 'sw',
          kind: 'route' as const,
          outcome: 'switch' as const,
          switchToProcedureId: 'proc-9',
        },
        { id: 'cl', kind: 'call' as const, subProcedureId: 'sub-1' },
        { id: 'op', kind: 'opaque' as const, label: 'code: compute total' },
      ],
      subProcedures: [
        {
          id: 'sub-1',
          name: 'Verify identity',
          steps: [{ id: 'v1', kind: 'instruction' as const, text: 'ask for the order number' }],
        },
      ],
    }

    const text = renderProcedureText(dsl, 'Refunds', 'when a refund is requested')

    expect(text).toContain('Procedure: Refunds')
    expect(text).toContain('When to use: when a refund is requested')
    expect(text).toContain('1. ')
    expect(text).toContain('…') // long instruction truncated
    expect(text).not.toContain(longText) // full text not present
    expect(text).toContain('IF the order has shipped')
    expect(text).toContain('→ finish')
    expect(text).toContain('ELSE')
    expect(text).toContain('→ hand off')
    expect(text).toContain('→ switch to procedure "proc-9"')
    expect(text).toContain('→ run sub-procedure "Verify identity"')
    expect(text).toContain('[code: compute total]')
    expect(text).toContain('Sub-procedure "Verify identity":')
    expect(text).toContain('ask for the order number')
  })
})
