// packages/lib/src/ai/mcp/client.ts
// The ONLY file allowed to import the @modelcontextprotocol SDK. Everything else goes through
// the wrappers here so the SDK surface stays contained (tools-only, Streamable HTTP, per-call
// sessions by design).

import type { McpToolDescriptor } from '@auxx/database'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpAuthError } from './errors'

const CLIENT_INFO = { name: 'auxx', version: '1.0.0' }

export interface McpSessionOpts {
  endpoint: string
  /** Authorization etc. — merged into the transport's requestInit.headers. */
  headers?: Record<string, string>
}

/**
 * Open a per-call MCP session over Streamable HTTP, run `fn`, and always close. A 401/403 from
 * the transport is rethrown as `McpAuthError` carrying the `WWW-Authenticate` header value
 * (phase-4 discovery parses it; the tool adapter maps it to reconnect).
 */
export async function withMcpSession<T>(
  opts: McpSessionOpts,
  fn: (client: Client, transport: StreamableHTTPClientTransport) => Promise<T>
): Promise<T> {
  // Capture auth-challenge details from the raw HTTP response — the SDK's thrown error only
  // carries a status code, not the WWW-Authenticate header we need for OAuth discovery.
  let authStatus: number | undefined
  let wwwAuthenticate: string | undefined

  const wrappedFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init)
    if (res.status === 401 || res.status === 403) {
      authStatus = res.status
      wwwAuthenticate = res.headers.get('www-authenticate') ?? undefined
    }
    return res
  }

  const transport = new StreamableHTTPClientTransport(new URL(opts.endpoint), {
    requestInit: opts.headers ? { headers: opts.headers } : undefined,
    fetch: wrappedFetch,
  })
  const client = new Client(CLIENT_INFO)

  try {
    await client.connect(transport)
    return await fn(client, transport)
  } catch (error) {
    if (authStatus === 401 || authStatus === 403) {
      throw new McpAuthError(`MCP server returned ${authStatus}`, {
        status: authStatus,
        wwwAuthenticate,
      })
    }
    throw error
  } finally {
    await client.close().catch(() => {})
  }
}

/** List a server's tools, mapping the SDK shape to our snapshot descriptor (annotations kept). */
export async function mcpListTools(opts: McpSessionOpts): Promise<{
  tools: McpToolDescriptor[]
  serverInfo: { name?: string; version?: string } | null
  protocolVersion: string | null
}> {
  return withMcpSession(opts, async (client, transport) => {
    const result = await client.listTools()
    const tools: McpToolDescriptor[] = result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
      annotations: t.annotations
        ? {
            readOnlyHint: t.annotations.readOnlyHint,
            destructiveHint: t.annotations.destructiveHint,
            title: t.annotations.title,
          }
        : undefined,
    }))
    const serverVersion = client.getServerVersion()
    return {
      tools,
      serverInfo: serverVersion
        ? { name: serverVersion.name, version: serverVersion.version }
        : null,
      protocolVersion: transport.protocolVersion ?? null,
    }
  })
}

/** Call a tool and normalize its content to a single string (text concatenated; non-text JSON). */
export async function mcpCallTool(
  opts: McpSessionOpts,
  name: string,
  args: Record<string, unknown>
): Promise<{ text: string; isError: boolean }> {
  return withMcpSession(opts, async (client) => {
    const result = await client.callTool({ name, arguments: args })
    const content = Array.isArray(result.content) ? result.content : []
    const text = content
      .map((part) =>
        part && typeof part === 'object' && (part as { type?: string }).type === 'text'
          ? String((part as { text?: unknown }).text ?? '')
          : JSON.stringify(part)
      )
      .join('\n')
    return { text, isError: result.isError === true }
  })
}
