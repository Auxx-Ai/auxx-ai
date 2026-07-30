// packages/lib/src/ai/mcp/connections/__tests__/mcp-connections.test.ts
//
// No DB harness exists, so `@auxx/credentials/store` is mocked wholesale and the tests assert
// the store calls / resolved payloads at the function level. `@auxx/database` is mocked only for
// the ConnectionDefinition lookup that `resolveMcpConnectionForRuntime` still does directly.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface StoreRecord {
  id: string
  mcpServerId: string | null
  metadata: Record<string, unknown>
  expiresAt: Date | null
  consecutiveRefreshFailures: number
}

const calls = {
  insert: [] as Record<string, unknown>[],
  rotate: [] as { id: string; secrets: Record<string, unknown>; options?: unknown }[],
  updateMetadata: [] as { id: string; input: Record<string, unknown> }[],
}

const storeState = {
  /** Record returned by findCredential (null = absent). */
  found: null as StoreRecord | null,
  /** Secrets returned by revealSecrets, keyed by credential id. */
  secrets: {} as Record<string, Record<string, unknown>>,
}

vi.mock('@auxx/credentials/store', () => ({
  insertCredential: async (input: Record<string, unknown>) => {
    calls.insert.push(input)
    return ok({ id: 'cred-1', metadata: input.metadata ?? {} })
  },
  rotateSecrets: async (
    id: string,
    _org: string,
    secrets: Record<string, unknown>,
    options?: unknown
  ) => {
    calls.rotate.push({ id, secrets, options })
    return ok(undefined)
  },
  updateCredential: async (id: string, _org: string, input: Record<string, unknown>) => {
    calls.updateMetadata.push({ id, input })
    return ok(undefined)
  },
  findCredential: async () => (storeState.found ? ok(storeState.found) : ok(null)),
  revealSecrets: async (id: string) => {
    const record = storeState.found
    if (!record) return err({ code: 'CREDENTIAL_NOT_FOUND', message: 'not found' })
    return ok({ record, secrets: storeState.secrets[id] ?? {} })
  },
}))

const queryStubs = {
  connectionDefinition: undefined as undefined | { connectionType: string } | null,
}

vi.mock('@auxx/database', async () => ({
  database: {
    query: {
      ConnectionDefinition: {
        findFirst: async () => queryStubs.connectionDefinition,
      },
    },
  },
  // `saveMcpConnection` builds its `where` from `schema.ConnectionDefinition`.
  schema: (await import('../../../../test/database-mock')).createSchemaMock(),
}))

import { resolveMcpConnectionForRuntime } from '../resolve-mcp-connection-for-runtime'
import { saveMcpConnection } from '../save-mcp-connection'

beforeEach(() => {
  calls.insert.length = 0
  calls.rotate.length = 0
  calls.updateMetadata.length = 0
  storeState.found = null
  storeState.secrets = {}
  queryStubs.connectionDefinition = undefined
})

describe('saveMcpConnection', () => {
  it('inserts an mcp credential with no app owner and split secrets', async () => {
    const result = await saveMcpConnection({
      mcpServerId: 'srv-1',
      serverName: 'Linear',
      organizationId: 'org-1',
      createdById: 'user-1',
      connectionData: { secret: 'sk-123', metadata: { authHeader: { name: 'X-Api-Key' } } },
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe('cred-1')

    const row = calls.insert[0]
    expect(row?.kind).toBe('mcp')
    expect(row?.type).toBeUndefined()
    expect(row?.appId).toBeUndefined()
    expect(row?.userId).toBeNull()
    expect(row?.mcpServerId).toBe('srv-1')
    expect(row?.name).toBe('Linear Connection')
    expect(row?.secrets).toEqual({ secret: 'sk-123' })
    expect(row?.metadata).toEqual({ authHeader: { name: 'X-Api-Key' } })
  })

  it('rotates secrets in place when connectionId is provided (reconnect)', async () => {
    const result = await saveMcpConnection({
      mcpServerId: 'srv-1',
      serverName: 'Linear',
      organizationId: 'org-1',
      createdById: 'user-1',
      connectionData: { accessToken: 'tok', expiresAt: '2030-01-01T00:00:00Z' },
      connectionId: 'cred-existing',
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe('cred-existing')
    expect(calls.insert.length).toBe(0)
    expect(calls.rotate[0]?.id).toBe('cred-existing')
    expect(calls.rotate[0]?.secrets).toEqual({ accessToken: 'tok' })
    expect((calls.rotate[0]?.options as { expiresAt: Date }).expiresAt).toBeInstanceOf(Date)
    expect(calls.updateMetadata[0]?.id).toBe('cred-existing')
  })
})

describe('resolveMcpConnectionForRuntime', () => {
  it('returns the revealed secret + metadata on the happy path', async () => {
    queryStubs.connectionDefinition = { connectionType: 'secret' }
    storeState.found = {
      id: 'cred-1',
      mcpServerId: 'srv-1',
      metadata: { a: 1 },
      expiresAt: null,
      consecutiveRefreshFailures: 0,
    }
    storeState.secrets = { 'cred-1': { secret: 'sk-123' } }

    const result = await resolveMcpConnectionForRuntime({
      mcpServerId: 'srv-1',
      organizationId: 'org-1',
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.type).toBe('secret')
      expect(result.value.value).toBe('sk-123')
      expect(result.value.metadata).toEqual({ a: 1 })
    }
  })

  it('returns a none connection without a credential', async () => {
    queryStubs.connectionDefinition = { connectionType: 'none' }
    storeState.found = null
    const result = await resolveMcpConnectionForRuntime({
      mcpServerId: 'srv-1',
      organizationId: 'org-1',
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.type).toBe('none')
      expect(result.value.value).toBe('')
    }
  })

  it('errors with CONNECTION_NOT_FOUND when the credential is missing', async () => {
    queryStubs.connectionDefinition = { connectionType: 'oauth2-code' }
    storeState.found = null
    const result = await resolveMcpConnectionForRuntime({
      mcpServerId: 'srv-1',
      organizationId: 'org-1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('CONNECTION_NOT_FOUND')
  })
})
