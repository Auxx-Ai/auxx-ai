// packages/lib/src/ai/mcp/snippet/__tests__/resolve-mcp-snippet.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────────

const curatedRows: { id: string; endpoint: string }[] = []
vi.mock('@auxx/database', () => ({
  database: { query: { McpServer: { findMany: async () => curatedRows } } },
  schema: { McpServer: { organizationId: 'organizationId' } },
}))

const discover = vi.fn()
vi.mock('../../discovery', () => ({ discoverMcpAuth: (...a: unknown[]) => discover(...a) }))

const registryLookup = vi.fn()
vi.mock('../mcp-registry-client', () => ({
  lookupRegistryRemote: (...a: unknown[]) => registryLookup(...a),
}))

// Make the SSRF guard a no-op except for an explicit private-IP host used in one test.
vi.mock('../ssrf', () => ({
  assertSafeOutboundUrl: async (url: string) => {
    if (url.includes('10.0.0.1'))
      throw new Error('Refusing to connect to a private address (10.0.0.1)')
    return new URL(url)
  },
}))

// Skip the favicon network hop.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: false, headers: { get: () => null } }) as unknown as Response)
)

import { resolveMcpSnippet } from '../resolve-mcp-snippet'

beforeEach(() => {
  curatedRows.length = 0
  discover.mockReset()
  registryLookup.mockReset()
})

describe('resolveMcpSnippet', () => {
  it('local-only package short-circuits with no network', async () => {
    const snippet = JSON.stringify({
      mcpServers: {
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      },
    })
    const [result] = await resolveMcpSnippet(snippet)
    expect(result?.kind).toBe('local-only')
    expect(discover).not.toHaveBeenCalled()
    expect(registryLookup).not.toHaveBeenCalled()
  })

  it('known package remote re-enters the remote probe', async () => {
    discover.mockResolvedValue(ok({ kind: 'none' }))
    const snippet = 'npx -y @upstash/context7-mcp'
    const [result] = await resolveMcpSnippet(snippet)
    expect(result).toMatchObject({
      kind: 'remote',
      endpoint: 'https://mcp.context7.com/mcp',
      auth: 'none',
    })
    expect(registryLookup).not.toHaveBeenCalled()
  })

  it('registry hit resolves a stdio package to its hosted remote', async () => {
    discover.mockResolvedValue(ok({ kind: 'none' }))
    registryLookup.mockResolvedValue({
      url: 'https://hosted.example/mcp',
      transport: 'http',
      requiredHeaders: ['X-Workspace'],
      name: 'Hosted',
      description: 'A hosted server',
    })
    const [result] = await resolveMcpSnippet('npx -y some-pkg')
    expect(result).toMatchObject({
      kind: 'remote',
      endpoint: 'https://hosted.example/mcp',
      description: 'A hosted server',
      placeholders: ['X-Workspace'],
    })
  })

  it('registry miss → unresolved (no hosted remote)', async () => {
    registryLookup.mockResolvedValue(null)
    const [result] = await resolveMcpSnippet('npx -y some-pkg')
    expect(result?.kind).toBe('unresolved')
  })

  it('oauth probe surfaces auth: oauth', async () => {
    discover.mockResolvedValue(
      ok({
        kind: 'oauth',
        authorizationServer: 'https://as',
        authorizeUrl: 'https://as/a',
        tokenUrl: 'https://as/t',
        resource: 'x',
      })
    )
    const [result] = await resolveMcpSnippet('https://acme.example/mcp')
    expect(result).toMatchObject({ kind: 'remote', auth: 'oauth' })
  })

  it('SSE sibling fallback retries the /mcp path', async () => {
    discover
      .mockResolvedValueOnce(err({ code: 'PROBE_FAILED', message: 'boom' }))
      .mockResolvedValueOnce(ok({ kind: 'none' }))
    const [result] = await resolveMcpSnippet('https://acme.example/sse')
    expect(result).toMatchObject({ kind: 'remote', endpoint: 'https://acme.example/mcp' })
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('sibling fallback also retries /sse when /mcp hard-fails', async () => {
    discover
      .mockResolvedValueOnce(err({ code: 'PROBE_FAILED', message: 'Cannot POST /mcp' }))
      .mockResolvedValueOnce(ok({ kind: 'none' }))
    const [result] = await resolveMcpSnippet('https://jobicy.com/mcp')
    expect(result).toMatchObject({ kind: 'remote', endpoint: 'https://jobicy.com/sse' })
  })

  it('an HTML probe error becomes a clean, honest reason (no HTML dump)', async () => {
    discover.mockResolvedValue(
      err({
        code: 'PROBE_FAILED',
        message: '<!DOCTYPE html><html><pre>Cannot POST /mcp</pre></html>',
      })
    )
    const [result] = await resolveMcpSnippet('https://jobicy.com/api')
    expect(result?.kind).toBe('unresolved')
    const reason = result && 'reason' in result ? result.reason : ''
    expect(reason).not.toMatch(/<html|DOCTYPE/i)
    expect(reason).toContain('(tried /api)') // surfaces the probed path
  })

  it('curated endpoint match sets curatedServerId', async () => {
    curatedRows.push({ id: 'curated-1', endpoint: 'https://acme.example/mcp' })
    discover.mockResolvedValue(ok({ kind: 'none' }))
    const [result] = await resolveMcpSnippet('https://acme.example/mcp')
    expect(result).toMatchObject({ kind: 'remote', curatedServerId: 'curated-1' })
  })

  it('SSRF rejection of a private-IP URL → unresolved', async () => {
    const [result] = await resolveMcpSnippet('https://10.0.0.1/mcp')
    expect(result?.kind).toBe('unresolved')
    expect(discover).not.toHaveBeenCalled()
  })
})
