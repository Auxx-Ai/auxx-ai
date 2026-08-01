// packages/lib/src/ai/mcp/__tests__/tool-adapter.test.ts

import { describe, expect, it, vi } from 'vitest'

// auth + client are network/db — mock them so the adapter tests stay pure.
vi.mock('../auth', () => ({
  buildMcpRequestContext: async () => {
    const { ok } = await import('neverthrow')
    return ok({ endpoint: 'https://x/mcp', headers: {} })
  },
}))
const callToolMock = vi.fn(
  async (..._a: unknown[]): Promise<McpCallResult> => ({ text: 'tool said hi', isError: false })
)
vi.mock('../client', () => ({ mcpCallTool: (...a: unknown[]) => callToolMock(...a) }))
vi.mock('../rate-limiter', () => ({ checkAndCountMcpCall: async () => ({ allowed: true }) }))
vi.mock('../connections', () => ({ markMcpConnectionFailed: vi.fn(async () => {}) }))

import { buildMcpAgentTools, mcpToolName, wrapMcpOutput } from '../tool-adapter'
import type { CachedMcpServer, McpCallResult } from '../types'

function makeServer(overrides: Partial<CachedMcpServer> = {}): CachedMcpServer {
  return {
    serverId: 'srv-1',
    slug: 'demo',
    name: 'Demo',
    description: null,
    icon: null,
    endpoint: 'https://demo.example.com/mcp',
    isCustom: true,
    toolsetSlug: 'mcp:srv-1',
    connectionType: 'secret',
    connectionPresent: true,
    connectionExpiresAt: null,
    needsReconnect: false,
    lastSyncedAt: null,
    lastSyncError: null,
    tools: [
      {
        name: 'echo',
        title: null,
        description: 'Echo',
        readOnlyHint: true,
        trusted: false,
        inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
        hasExampleOutput: false,
      },
      {
        name: 'do_write',
        title: null,
        description: 'Write',
        readOnlyHint: false,
        trusted: false,
        inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
        hasExampleOutput: false,
      },
    ],
    ...overrides,
  }
}

describe('mcpToolName', () => {
  it('produces a stable short name and is deterministic for long names', () => {
    expect(mcpToolName('demo', 'echo')).toBe('mcp__demo__echo')

    const long = 'a_very_long_tool_name_that_definitely_exceeds_the_sixty_char_limit_for_sure'
    const a = mcpToolName('someserver', long)
    const b = mcpToolName('someserver', long)
    expect(a).toBe(b) // deterministic
    expect(a.length).toBeLessThanOrEqual(60)
    expect(a.startsWith('mcp__someserver__')).toBe(true)
    // distinct tool names → distinct registered names (collision guard)
    expect(mcpToolName('someserver', `${long}_x`)).not.toBe(a)
  })
})

describe('buildMcpAgentTools — approval matrix', () => {
  it('readOnly → no approval; write+untrusted → approval', () => {
    const tools = buildMcpAgentTools({ server: makeServer(), autonomous: false })
    expect(tools.map((t) => t.name).sort()).toEqual(['mcp__demo__do_write', 'mcp__demo__echo'])
    const echo = tools.find((t) => t.name === 'mcp__demo__echo')!
    const write = tools.find((t) => t.name === 'mcp__demo__do_write')!
    expect(echo.requiresApproval).toBe(false)
    expect(write.requiresApproval).toBe(true)
  })

  it('trusted write → no approval', () => {
    const server = makeServer()
    server.tools[1]!.trusted = true
    const tools = buildMcpAgentTools({ server, autonomous: false })
    expect(tools.find((t) => t.name === 'mcp__demo__do_write')!.requiresApproval).toBe(false)
  })

  it('autonomous run drops untrusted write tools but keeps readOnly', () => {
    const tools = buildMcpAgentTools({ server: makeServer(), autonomous: true })
    expect(tools.map((t) => t.name)).toEqual(['mcp__demo__echo'])
  })

  it('autonomous run keeps trusted write tools', () => {
    const server = makeServer()
    server.tools[1]!.trusted = true
    const tools = buildMcpAgentTools({ server, autonomous: true })
    expect(tools.map((t) => t.name).sort()).toEqual(['mcp__demo__do_write', 'mcp__demo__echo'])
  })
})

describe('buildMcpAgentTools — validateInputs (ajv)', () => {
  const ctx = { organizationId: 'org-1', turnId: 't1' } as never

  it('rejects invalid args and accepts valid ones', async () => {
    const [echo] = buildMcpAgentTools({ server: makeServer(), autonomous: false })
    const bad = await echo!.validateInputs!({ message: 123 }, ctx)
    expect(bad.ok).toBe(false)
    const good = await echo!.validateInputs!({ message: 'hi' }, ctx)
    expect(good.ok).toBe(true)
  })

  it('treats a nonstandard schema as no-validation (does not brick the tool)', async () => {
    const server = makeServer()
    // a schema ajv cannot compile
    server.tools[0]!.inputSchema = { type: 'not-a-real-type' }
    const [echo] = buildMcpAgentTools({ server, autonomous: false })
    const result = await echo!.validateInputs!({ anything: true }, ctx)
    expect(result.ok).toBe(true)
  })
})

describe('execute structured (walkable) output', () => {
  it('declares the injection-boundary marker on the tool definition', () => {
    const [echo] = buildMcpAgentTools({ server: makeServer(), autonomous: false })
    expect(echo!.outputBoundary).toEqual({ server: 'demo', tool: 'echo' })
    // The fence helper is still exported (re-exported from the wire layer).
    expect(wrapMcpOutput('demo', 'echo', 'x')).toContain('<mcp_tool_output')
  })

  it('returns a plain-text result as a raw string (not walkable, no fence)', async () => {
    callToolMock.mockResolvedValueOnce({ text: 'tool said hi', isError: false })
    const [echo] = buildMcpAgentTools({ server: makeServer(), autonomous: false })
    const result = await echo!.execute({ message: 'x' }, {
      organizationId: 'org-1',
      turnId: 't1',
    } as never)
    expect(result).toEqual({ success: true, output: 'tool said hi' })
  })

  it('returns structuredContent verbatim as the walkable output', async () => {
    callToolMock.mockResolvedValueOnce({
      text: 'ignored when structured present',
      structuredContent: { count: 2, items: ['a'] },
      isError: false,
    })
    const [echo] = buildMcpAgentTools({ server: makeServer(), autonomous: false })
    const result = await echo!.execute({ message: 'x' }, {
      organizationId: 'org-1',
      turnId: 't1',
    } as never)
    expect(result).toEqual({ success: true, output: { count: 2, items: ['a'] } })
  })

  it('parses a JSON-text result (incl. top-level arrays) into structured output', async () => {
    callToolMock.mockResolvedValueOnce({
      text: JSON.stringify([{ id: 1 }, { id: 2 }]),
      isError: false,
    })
    const [echo] = buildMcpAgentTools({ server: makeServer(), autonomous: false })
    const result = await echo!.execute({ message: 'x' }, {
      organizationId: 'org-1',
      turnId: 't1',
    } as never)
    expect(result).toEqual({ success: true, output: [{ id: 1 }, { id: 2 }] })
  })

  it('keeps the structured value on output for an isError result, with a readable error', async () => {
    callToolMock.mockResolvedValueOnce({
      text: JSON.stringify({ message: 'nope' }),
      structuredContent: { message: 'nope' },
      isError: true,
    })
    const [echo] = buildMcpAgentTools({ server: makeServer(), autonomous: false })
    const result = await echo!.execute({ message: 'x' }, {
      organizationId: 'org-1',
      turnId: 't1',
    } as never)
    expect(result).toMatchObject({
      success: false,
      output: { message: 'nope' },
      error: JSON.stringify({ message: 'nope' }),
    })
  })
})
