// packages/lib/src/ai/mcp/testing/mock-server.ts
//
// Minimal Streamable HTTP MCP server for tests (no express dep). Speaks just enough JSON-RPC
// for the runtime: `initialize`, `tools/list`, `tools/call`. Configurable bearer requirement
// and a mutable tool list (for re-sync tests).

import { createServer, type Server } from 'node:http'

export interface MockTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string }
}

export interface MockMcpServerHandle {
  url: string
  close: () => Promise<void>
  /** Recorded tools/call invocations. */
  calls: Array<{ name: string; args: Record<string, unknown> }>
  /** Mutate the served tool list (re-sync tests read the new list). */
  setTools: (tools: MockTool[]) => void
}

const DEFAULT_TOOLS: MockTool[] = [
  {
    name: 'echo',
    description: 'Echo the input back',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    annotations: { readOnlyHint: true, title: 'Echo' },
  },
  {
    name: 'do_write',
    description: 'Perform a write',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    // No readOnlyHint → treated as a write (requires approval).
  },
]

function jsonResponse(res: import('node:http').ServerResponse, payload: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/**
 * Start a mock MCP server. `requireBearer` rejects requests without a matching token (401 +
 * WWW-Authenticate). Returns a handle with the URL, a close fn, recorded calls, and setTools.
 */
export async function startMockMcpServer(
  opts: { requireBearer?: string; tools?: MockTool[] } = {}
): Promise<MockMcpServerHandle> {
  let tools: MockTool[] = opts.tools ?? [...DEFAULT_TOOLS]
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []

  const server: Server = createServer((req, res) => {
    // The transport opens a GET SSE stream — we don't push server-initiated messages.
    if (req.method === 'GET') {
      res.writeHead(405).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end()
      return
    }

    if (opts.requireBearer) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${opts.requireBearer}`) {
        res.writeHead(401, {
          'WWW-Authenticate': `Bearer realm="mcp", resource_metadata="${baseUrl()}/.well-known/oauth-protected-resource"`,
        })
        res.end()
        return
      }
    }

    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      let msg: { id?: unknown; method?: string; params?: Record<string, unknown> }
      try {
        const parsed = JSON.parse(body)
        msg = Array.isArray(parsed) ? parsed[0] : parsed
      } catch {
        res.writeHead(400).end()
        return
      }

      const { id, method, params } = msg

      // Notifications (no id) — accept with no body.
      if (id === undefined || id === null) {
        res.writeHead(202).end()
        return
      }

      if (method === 'initialize') {
        jsonResponse(res, {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: (params?.protocolVersion as string) ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-mcp', version: '0.0.1' },
          },
        })
        return
      }

      if (method === 'tools/list') {
        jsonResponse(res, { jsonrpc: '2.0', id, result: { tools } })
        return
      }

      if (method === 'tools/call') {
        const name = params?.name as string
        const args = (params?.arguments as Record<string, unknown>) ?? {}
        calls.push({ name, args })
        jsonResponse(res, {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(args) }],
            isError: false,
          },
        })
        return
      }

      jsonResponse(res, {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock MCP server')
  const port = address.port
  function baseUrl() {
    return `http://127.0.0.1:${port}`
  }

  return {
    url: `${baseUrl()}/mcp`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    calls,
    setTools: (next) => {
      tools = next
    },
  }
}
