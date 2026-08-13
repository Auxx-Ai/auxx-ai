// packages/lib/src/ai/mcp/__tests__/call-with-auth-retry.test.ts
//
// Auth context, the MCP client, and the connections module are mocked; the tests assert the
// 401 → refresh → retry decision tree and that only unrecoverable auth failures flag the
// connection for reconnect.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { McpAuthError } from '../errors'

const state = {
  /** Headers returned by successive buildMcpRequestContext calls. */
  contexts: [] as { token: string }[],
  contextError: null as string | null,
  connectionType: 'oauth2-code' as 'oauth2-code' | 'secret' | 'none',
  hasRefreshToken: true,
  /** Outcomes for successive mcpCallTool calls: 'ok' | 'auth' | Error. */
  callOutcomes: [] as ('ok' | 'auth' | Error)[],
  refreshCalls: [] as { credentialId: string; force?: boolean }[],
  markedFailed: [] as string[],
}

vi.mock('../auth', () => ({
  buildMcpRequestContext: async () => {
    if (state.contextError) {
      const { err } = await import('neverthrow')
      return err({ code: 'CONNECTION_ERROR', message: state.contextError })
    }
    const next = state.contexts.shift() ?? { token: 'tok' }
    return ok({
      endpoint: 'https://mcp.example.com',
      headers: { Authorization: `Bearer ${next.token}` },
      connectionId: 'cred-1',
      connectionType: state.connectionType,
      hasRefreshToken: state.hasRefreshToken,
    })
  },
}))

vi.mock('../client', () => ({
  mcpCallTool: async () => {
    const outcome = state.callOutcomes.shift() ?? 'ok'
    if (outcome === 'ok') return { text: 'result', isError: false }
    if (outcome === 'auth') throw new McpAuthError('401', { status: 401 })
    throw outcome
  },
}))

vi.mock('../../../credentials/credential-lock', () => ({ credentialLock: null }))

vi.mock('@auxx/credentials/connections', () => ({
  ensureFreshCredentialToken: async (input: { credentialId: string; force?: boolean }) => {
    state.refreshCalls.push(input)
    return true
  },
}))

vi.mock('../connections', () => ({
  markMcpConnectionFailed: async (input: { mcpServerId: string }) => {
    state.markedFailed.push(input.mcpServerId)
  },
}))

import { callMcpToolWithAuthRetry } from '../call-with-auth-retry'

const opts = {
  mcpServerId: 'srv-1',
  organizationId: 'org-1',
  toolName: 'search',
  args: {},
}

beforeEach(() => {
  state.contexts = []
  state.contextError = null
  state.connectionType = 'oauth2-code'
  state.hasRefreshToken = true
  state.callOutcomes = []
  state.refreshCalls = []
  state.markedFailed = []
})

describe('callMcpToolWithAuthRetry', () => {
  it('returns the result on first-try success', async () => {
    state.callOutcomes = ['ok']
    const outcome = await callMcpToolWithAuthRetry(opts)
    expect(outcome).toEqual({ ok: true, result: { text: 'result', isError: false } })
    expect(state.refreshCalls).toHaveLength(0)
  })

  it('maps a context failure', async () => {
    state.contextError = 'connection missing'
    const outcome = await callMcpToolWithAuthRetry(opts)
    expect(outcome).toEqual({ ok: false, kind: 'context', message: 'connection missing' })
  })

  it('passes non-auth errors through for the caller to map', async () => {
    const boom = new Error('ECONNRESET')
    state.callOutcomes = [boom]
    const outcome = await callMcpToolWithAuthRetry(opts)
    expect(outcome).toEqual({ ok: false, kind: 'error', error: boom })
    expect(state.refreshCalls).toHaveLength(0)
    expect(state.markedFailed).toHaveLength(0)
  })

  it('recovers from a 401 via force refresh + retry, without flagging the connection', async () => {
    state.callOutcomes = ['auth', 'ok']
    const outcome = await callMcpToolWithAuthRetry(opts)
    expect(outcome.ok).toBe(true)
    // `lock` is the injected single-flight provider (stubbed null here) — the refresh seam moved
    // to @auxx/credentials, which takes the lock as a parameter rather than importing Redis.
    expect(state.refreshCalls).toEqual([
      {
        credentialId: 'cred-1',
        organizationId: 'org-1',
        hasRefreshToken: true,
        force: true,
        lock: null,
      },
    ])
    expect(state.markedFailed).toHaveLength(0)
  })

  it('flags the connection when the retry also fails auth', async () => {
    state.callOutcomes = ['auth', 'auth']
    const outcome = await callMcpToolWithAuthRetry(opts)
    expect(outcome).toMatchObject({ ok: false, kind: 'auth' })
    expect(state.refreshCalls).toHaveLength(1)
    expect(state.markedFailed).toEqual(['srv-1'])
  })

  it('skips the refresh attempt without a refresh token and flags immediately', async () => {
    state.hasRefreshToken = false
    state.callOutcomes = ['auth']
    const outcome = await callMcpToolWithAuthRetry(opts)
    expect(outcome).toMatchObject({ ok: false, kind: 'auth' })
    expect(state.refreshCalls).toHaveLength(0)
    expect(state.markedFailed).toEqual(['srv-1'])
  })

  it('skips the refresh attempt for non-oauth connections', async () => {
    state.connectionType = 'secret'
    state.callOutcomes = ['auth']
    const outcome = await callMcpToolWithAuthRetry(opts)
    expect(outcome).toMatchObject({ ok: false, kind: 'auth' })
    expect(state.refreshCalls).toHaveLength(0)
    expect(state.markedFailed).toEqual(['srv-1'])
  })

  it('passes a non-auth retry error through', async () => {
    const boom = new Error('500 after refresh')
    state.callOutcomes = ['auth', boom]
    const outcome = await callMcpToolWithAuthRetry(opts)
    expect(outcome).toEqual({ ok: false, kind: 'error', error: boom })
    expect(state.markedFailed).toHaveLength(0)
  })
})
