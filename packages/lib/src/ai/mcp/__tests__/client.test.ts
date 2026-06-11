// packages/lib/src/ai/mcp/__tests__/client.test.ts

import { afterEach, describe, expect, it } from 'vitest'
import { mcpCallTool, mcpListTools } from '../client'
import { McpAuthError } from '../errors'
import { type MockMcpServerHandle, startMockMcpServer } from '../testing/mock-server'

describe('mcp client', () => {
  let server: MockMcpServerHandle

  afterEach(async () => {
    await server?.close()
  })

  it('lists tools with annotations preserved', async () => {
    server = await startMockMcpServer()
    const { tools, serverInfo } = await mcpListTools({ endpoint: server.url })

    expect(tools.map((t) => t.name).sort()).toEqual(['do_write', 'echo'])
    const echo = tools.find((t) => t.name === 'echo')
    expect(echo?.annotations?.readOnlyHint).toBe(true)
    expect(serverInfo?.name).toBe('mock-mcp')
  })

  it('calls a tool and normalizes the content to a string', async () => {
    server = await startMockMcpServer()
    const result = await mcpCallTool({ endpoint: server.url }, 'echo', { message: 'hi' })

    expect(result.isError).toBe(false)
    expect(result.text).toContain('hi')
    expect(server.calls).toEqual([{ name: 'echo', args: { message: 'hi' } }])
  })

  it('passes the bearer token through when required', async () => {
    server = await startMockMcpServer({ requireBearer: 'sk-123' })
    const { tools } = await mcpListTools({
      endpoint: server.url,
      headers: { Authorization: 'Bearer sk-123' },
    })
    expect(tools.length).toBe(2)
  })

  it('throws McpAuthError with the WWW-Authenticate header on 401', async () => {
    server = await startMockMcpServer({ requireBearer: 'sk-123' })
    await expect(mcpListTools({ endpoint: server.url })).rejects.toMatchObject({
      name: 'McpAuthError',
      status: 401,
    })
    try {
      await mcpListTools({ endpoint: server.url })
    } catch (e) {
      expect(e).toBeInstanceOf(McpAuthError)
      expect((e as McpAuthError).wwwAuthenticate).toContain('resource_metadata')
    }
  })
})
