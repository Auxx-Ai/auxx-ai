// packages/lib/src/evals/__tests__/mock-tools.test.ts

import type { SimulationToolMock } from '@auxx/types/evals'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ToolContext } from '../../ai/agent-framework/tool-context'
import type { AgentToolDefinition } from '../../ai/agent-framework/types'
import {
  argsMatch,
  createMockResolver,
  scaffoldFromSchema,
  type ToolInvocationRecord,
  UNMATCHED_MOCK_ERROR,
  validateMockOutput,
  wrapToolsWithMocks,
} from '../simulation/mock-tools'

const mock = (over: Partial<SimulationToolMock>): SimulationToolMock => ({
  id: 'm1',
  toolName: 'find_threads',
  output: { ok: true },
  usage: 'repeat',
  ...over,
})

const fakeTool = (over: Partial<AgentToolDefinition>): AgentToolDefinition =>
  ({
    name: 'find_threads',
    displayName: 'Find',
    description: '',
    parameters: { type: 'object' },
    execute: vi.fn(async () => ({ success: true, output: { real: true } })),
    ...over,
  }) as AgentToolDefinition

const ctx = {} as ToolContext

describe('argsMatch', () => {
  it('no matcher accepts any args', () => {
    expect(argsMatch(undefined, { a: 1, b: 2 })).toBe(true)
  })

  it('exact requires order-independent deep equality of the whole object', () => {
    const m = { mode: 'exact' as const, value: { a: 1, b: 2 } }
    expect(argsMatch(m, { b: 2, a: 1 })).toBe(true)
    expect(argsMatch(m, { a: 1, b: 2, c: 3 })).toBe(false)
    expect(argsMatch(m, { a: 1 })).toBe(false)
  })

  it('subset requires configured keys present; extra runtime keys allowed', () => {
    const m = { mode: 'subset' as const, value: { orderId: 1234 } }
    expect(argsMatch(m, { orderId: 1234, locale: 'en' })).toBe(true)
    expect(argsMatch(m, { orderId: 9999 })).toBe(false)
    expect(argsMatch(m, { locale: 'en' })).toBe(false)
  })
})

describe('createMockResolver', () => {
  it('first matching mock in stored order wins', () => {
    const r = createMockResolver([mock({ id: 'a', output: 'A' }), mock({ id: 'b', output: 'B' })])
    expect(r.resolve('find_threads', {})?.mock.id).toBe('a')
  })

  it('once is consumed after one match; repeat persists', () => {
    const r = createMockResolver([
      mock({ id: 'once', usage: 'once', output: 'O' }),
      mock({ id: 'rep', usage: 'repeat', output: 'R' }),
    ])
    expect(r.resolve('find_threads', {})?.mock.id).toBe('once')
    // 'once' consumed → falls through to 'rep'
    expect(r.resolve('find_threads', {})?.mock.id).toBe('rep')
    expect(r.resolve('find_threads', {})?.mock.id).toBe('rep')
  })

  it('distinct arg matchers route different calls to different responses', () => {
    const r = createMockResolver([
      mock({ id: 'found', args: { mode: 'subset', value: { orderId: 1234 } }, output: 'found' }),
      mock({
        id: 'missing',
        args: { mode: 'subset', value: { orderId: 9999 } },
        output: 'missing',
      }),
    ])
    expect(r.resolve('find_threads', { orderId: 1234 })?.output).toBe('found')
    expect(r.resolve('find_threads', { orderId: 9999 })?.output).toBe('missing')
  })

  it('returns null on no match', () => {
    const r = createMockResolver([mock({ toolName: 'other' })])
    expect(r.resolve('find_threads', {})).toBeNull()
  })
})

describe('wrapToolsWithMocks', () => {
  const collect = () => {
    const records: ToolInvocationRecord[] = []
    const unmatched: string[] = []
    const passthrough: string[] = []
    return {
      records,
      unmatched,
      passthrough,
      onInvocation: (r: ToolInvocationRecord) => records.push(r),
      onUnmatched: (t: string) => unmatched.push(t),
      onPassthrough: (t: string) => passthrough.push(t),
    }
  }

  it('returns mock output and never calls the real execute on a hit', async () => {
    const sink = collect()
    const tool = fakeTool({})
    const [wrapped] = wrapToolsWithMocks([tool], {
      mocks: [mock({ output: { mocked: true } })],
      unmatchedPolicy: 'error',
      ...sink,
    })
    const res = await asResult(wrapped!.execute({ q: 'x' }, ctx))
    expect(res).toEqual({ success: true, output: { mocked: true } })
    expect(tool.execute).not.toHaveBeenCalled()
    expect(sink.records[0]).toMatchObject({ resolution: 'mock', mockId: 'm1', captured: false })
  })

  it('falls back to the live exampleOutput when no literal mock matches', async () => {
    const sink = collect()
    const tool = fakeTool({ exampleOutput: { threads: [] } })
    const [wrapped] = wrapToolsWithMocks([tool], {
      mocks: [],
      unmatchedPolicy: 'error',
      ...sink,
    })
    const res = await asResult(wrapped!.execute({ q: 'x' }, ctx))
    expect(res).toEqual({ success: true, output: { threads: [] } })
    expect(tool.execute).not.toHaveBeenCalled()
    expect(sink.unmatched).toHaveLength(0)
    expect(sink.records[0]).toMatchObject({
      resolution: 'tool_example',
      mockId: null,
      captured: false,
    })
  })

  it('a literal mock wins over the exampleOutput', async () => {
    const sink = collect()
    const tool = fakeTool({ exampleOutput: { from: 'example' } })
    const [wrapped] = wrapToolsWithMocks([tool], {
      mocks: [mock({ output: { from: 'literal' } })],
      unmatchedPolicy: 'error',
      ...sink,
    })
    const res = await asResult(wrapped!.execute({}, ctx))
    expect(res.output).toEqual({ from: 'literal' })
    expect(sink.records[0]).toMatchObject({ resolution: 'mock', mockId: 'm1' })
  })

  it('a consumed once mock falls through to the exampleOutput on later calls', async () => {
    const sink = collect()
    const tool = fakeTool({ exampleOutput: { from: 'example' } })
    const [wrapped] = wrapToolsWithMocks([tool], {
      mocks: [mock({ usage: 'once', output: { from: 'literal' } })],
      unmatchedPolicy: 'error',
      ...sink,
    })
    expect((await asResult(wrapped!.execute({}, ctx))).output).toEqual({ from: 'literal' })
    expect((await asResult(wrapped!.execute({}, ctx))).output).toEqual({ from: 'example' })
    expect(sink.records.map((r) => r.resolution)).toEqual(['mock', 'tool_example'])
  })

  it('the exampleOutput wins over passthrough_readonly — run stays offline', async () => {
    const sink = collect()
    const tool = fakeTool({ idempotent: true, exampleOutput: { offline: true } })
    const [wrapped] = wrapToolsWithMocks([tool], {
      mocks: [],
      unmatchedPolicy: 'passthrough_readonly',
      ...sink,
    })
    const res = await asResult(wrapped!.execute({}, ctx))
    expect(res).toEqual({ success: true, output: { offline: true } })
    expect(tool.execute).not.toHaveBeenCalled()
    expect(sink.passthrough).toHaveLength(0)
  })

  it('fails closed on unmatched under error policy', async () => {
    const sink = collect()
    const tool = fakeTool({})
    const [wrapped] = wrapToolsWithMocks([tool], {
      mocks: [],
      unmatchedPolicy: 'error',
      ...sink,
    })
    const res = await asResult(wrapped!.execute({}, ctx))
    expect(res.success).toBe(false)
    expect((res.output as { error: string }).error).toBe(UNMATCHED_MOCK_ERROR)
    expect(tool.execute).not.toHaveBeenCalled()
    expect(sink.unmatched).toEqual(['find_threads'])
  })

  it('passthrough_readonly runs the real execute only for idempotent tools', async () => {
    const sink = collect()
    const readTool = fakeTool({ name: 'find_threads', idempotent: true })
    const [wrapped] = wrapToolsWithMocks([readTool], {
      mocks: [],
      unmatchedPolicy: 'passthrough_readonly',
      ...sink,
    })
    const res = await asResult(wrapped!.execute({}, ctx))
    expect(res).toEqual({ success: true, output: { real: true } })
    expect(readTool.execute).toHaveBeenCalledOnce()
    expect(sink.passthrough).toEqual(['find_threads'])
  })

  it('writes are always bypassed even under passthrough_readonly', async () => {
    const sink = collect()
    const writeTool = fakeTool({ name: 'send_reply', idempotent: false })
    const [wrapped] = wrapToolsWithMocks([writeTool], {
      mocks: [],
      unmatchedPolicy: 'passthrough_readonly',
      ...sink,
    })
    const res = await asResult(wrapped!.execute({}, ctx))
    expect(res.success).toBe(false)
    expect(writeTool.execute).not.toHaveBeenCalled()
    expect(sink.unmatched).toEqual(['send_reply'])
  })

  it('captureMint falls back to the exampleOutput when the tool has no own mint', () => {
    const sink = collect()
    const tool = fakeTool({ exampleOutput: { minted: 'example' } })
    const [wrapped] = wrapToolsWithMocks([tool], {
      mocks: [],
      unmatchedPolicy: 'error',
      ...sink,
    })
    expect(wrapped!.captureMint?.({}, { localIndex: 0 })).toEqual({ minted: 'example' })
    expect(sink.records[0]).toMatchObject({ resolution: 'tool_example', captured: true })
  })

  it("captureMint prefers the tool's own (args-aware) mint over the exampleOutput", () => {
    const sink = collect()
    const tool = fakeTool({
      exampleOutput: { minted: 'example' },
      captureMint: (args) => ({ minted: args.title }),
    })
    const [wrapped] = wrapToolsWithMocks([tool], {
      mocks: [],
      unmatchedPolicy: 'error',
      ...sink,
    })
    expect(wrapped!.captureMint?.({ title: 'T' }, { localIndex: 0 })).toEqual({ minted: 'T' })
    expect(sink.records).toHaveLength(0) // own-mint path emits no record (unchanged)
  })

  // control tools (procedure/plan signals) must bypass wrapping entirely — they
  // aren't idempotent, so wrapping would fail the first unmatched advance closed.
  for (const policy of ['error', 'passthrough_readonly'] as const) {
    it(`control tools pass through unwrapped under ${policy} policy`, async () => {
      const sink = collect()
      const control = fakeTool({
        name: 'advance_procedure',
        category: 'control',
        idempotent: false,
        execute: vi.fn(async () => ({ success: true, output: { signal: 'advance' } })),
      })
      const [wrapped] = wrapToolsWithMocks([control], {
        // a mock authored against the control tool must NOT intercept it
        mocks: [mock({ toolName: 'advance_procedure', output: { hijacked: true } })],
        unmatchedPolicy: policy,
        ...sink,
      })
      expect(wrapped).toBe(control) // same reference — not wrapped
      const res = await asResult(wrapped!.execute({}, ctx))
      expect(res).toEqual({ success: true, output: { signal: 'advance' } })
      expect(control.execute).toHaveBeenCalledOnce()
      expect(sink.records).toHaveLength(0) // no invocation record
      expect(sink.unmatched).toHaveLength(0) // never fails closed
    })
  }
})

describe('validateMockOutput', () => {
  it('warns when the tool declares no output schema', () => {
    const r = validateMockOutput({ name: 't' }, { anything: true })
    expect(r.ok).toBe(true)
    expect('warning' in r && r.warning).toContain('no output schema')
  })

  it('rejects output that does not match the schema', () => {
    const schema = z.object({ count: z.number() })
    const r = validateMockOutput({ name: 'find_threads', outputSchema: schema }, { count: 'nope' })
    expect(r.ok).toBe(false)
  })

  it('accepts schema-valid output', () => {
    const schema = z.object({ count: z.number() })
    expect(validateMockOutput({ name: 'x', outputSchema: schema }, { count: 2 }).ok).toBe(true)
  })
})

describe('scaffoldFromSchema', () => {
  it('produces a valid-shaped skeleton for an object schema', () => {
    const schema = z.object({
      count: z.number(),
      threads: z.array(z.object({ id: z.string(), open: z.boolean() })),
    })
    const skeleton = scaffoldFromSchema(schema)
    // The skeleton must itself parse against the schema.
    expect(schema.safeParse(skeleton).success).toBe(true)
  })
})

// Helper: the wrapped execute always returns a Promise in these tests.
function asResult(
  ret: ReturnType<AgentToolDefinition['execute']>
): Promise<{ success: boolean; output: unknown; error?: string }> {
  return ret as Promise<{ success: boolean; output: unknown; error?: string }>
}
