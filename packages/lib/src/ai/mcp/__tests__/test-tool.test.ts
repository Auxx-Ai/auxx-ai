// packages/lib/src/ai/mcp/__tests__/test-tool.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = {
  servers: [] as unknown[],
  callImpl: undefined as undefined | (() => Promise<unknown>),
  rateAllowed: true,
}

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: async () => stubs.servers }),
}))

vi.mock('../auth', () => ({
  buildMcpRequestContext: async () => {
    const { ok } = await import('neverthrow')
    return ok({ endpoint: 'https://x/mcp', headers: {} })
  },
}))

vi.mock('../client', () => ({
  mcpCallTool: async () => {
    if (stubs.callImpl) return stubs.callImpl()
    return { text: '{}', structuredContent: undefined, isError: false }
  },
}))

const markFailed = vi.fn(async () => {})
vi.mock('../connections', () => ({
  markMcpConnectionFailed: (...a: unknown[]) => markFailed(...a),
}))

vi.mock('../rate-limiter', () => ({
  checkAndCountMcpCall: async () => ({ allowed: stubs.rateAllowed, reason: 'org' as const }),
}))

import { McpAuthError } from '../errors'
import { testMcpTool } from '../test-tool'

const server = (tools: unknown[]) => ({
  serverId: 'srv-1',
  slug: 'demo',
  tools,
})
const echoTool = {
  name: 'echo',
  inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
  hasExampleOutput: false,
}

const run = (over: Record<string, unknown> = {}) =>
  testMcpTool({
    organizationId: 'org-1',
    userId: 'user-1',
    serverId: 'srv-1',
    toolName: 'echo',
    args: { message: 'hi' },
    ...over,
  })

beforeEach(() => {
  stubs.servers = [server([echoTool])]
  stubs.callImpl = undefined
  stubs.rateAllowed = true
  markFailed.mockClear()
})

describe('testMcpTool', () => {
  it('returns unknown_tool when the tool is not in the snapshot', async () => {
    const result = await run({ toolName: 'missing' })
    expect(result).toMatchObject({ ok: false, code: 'unknown_tool' })
  })

  it('happy path returns the result + an inferred schema', async () => {
    stubs.callImpl = async () => ({
      text: 'ignored',
      structuredContent: { count: 2, label: 'x' },
      isError: false,
    })
    const result = await run()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual({ count: 2, label: 'x' })
    expect(result.inferredSchema).toEqual({
      type: 'object',
      properties: { count: { type: 'number' }, label: { type: 'string' } },
    })
    expect(typeof result.durationMs).toBe('number')
  })

  it('infers a schema from JSON text when no structuredContent is present', async () => {
    stubs.callImpl = async () => ({ text: '{"ok":true}', isError: false })
    const result = await run()
    if (!result.ok) throw new Error('expected ok')
    expect(result.inferredSchema).toEqual({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    })
  })

  it('surfaces a tool error as ok:true / isError:true', async () => {
    stubs.callImpl = async () => ({ text: 'boom', isError: true })
    const result = await run()
    expect(result).toMatchObject({ ok: true, isError: true, text: 'boom' })
  })

  it('returns rate_limited when the ceiling is hit (no call made)', async () => {
    stubs.rateAllowed = false
    const result = await run()
    expect(result).toMatchObject({ ok: false, code: 'rate_limited' })
  })

  it('rejects invalid args before calling', async () => {
    const result = await run({ args: { message: 123 } })
    expect(result).toMatchObject({ ok: false, code: 'invalid_args' })
  })

  it('maps an auth failure to a reconnect message and flags the connection', async () => {
    stubs.callImpl = async () => {
      throw new McpAuthError('401', { status: 401 })
    }
    const result = await run()
    expect(result).toMatchObject({ ok: false, code: 'auth' })
    expect(markFailed).toHaveBeenCalledWith({ mcpServerId: 'srv-1', organizationId: 'org-1' })
  })
})
