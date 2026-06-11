// packages/lib/src/ai/mcp/connections/__tests__/mcp-connections.test.ts
//
// No DB harness exists, so `@auxx/database` + `@auxx/credentials` are mocked wholesale
// and the tests assert the `.values(...)` shapes / resolved payloads at the function level
// (sidesteps the Drizzle-columns-undefined-under-vitest gotcha).

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/credentials', () => ({
  CredentialService: {
    encrypt: (data: unknown) => `enc:${JSON.stringify(data)}`,
    decrypt: (blob: string) => JSON.parse(blob.replace(/^enc:/, '')),
  },
}))

const insertedValues: { values: Record<string, unknown> }[] = []
const updatedValues: { values: Record<string, unknown> }[] = []
const queryStubs = {
  connectionDefinition: undefined as undefined | { connectionType: string } | null,
  workflowCredential: undefined as undefined | { id: string; encryptedData: string } | null,
}

vi.mock('@auxx/database', () => {
  const database = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push({ values })
        return { returning: async () => [{ id: 'cred-1' }] }
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updatedValues.push({ values })
        return { where: async () => undefined }
      },
    }),
    query: {
      ConnectionDefinition: {
        findFirst: async () => queryStubs.connectionDefinition,
      },
      WorkflowCredentials: {
        findFirst: async () => queryStubs.workflowCredential,
      },
    },
  }
  return { database, schema: { WorkflowCredentials: {}, ConnectionDefinition: {} } }
})

import { resolveMcpConnectionForRuntime } from '../resolve-mcp-connection-for-runtime'
import { saveMcpConnection } from '../save-mcp-connection'

beforeEach(() => {
  insertedValues.length = 0
  updatedValues.length = 0
  queryStubs.connectionDefinition = undefined
  queryStubs.workflowCredential = undefined
})

describe('saveMcpConnection', () => {
  it('inserts a mcp-connection row with no app owner and an encrypted payload', async () => {
    const result = await saveMcpConnection({
      mcpServerId: 'srv-1',
      serverName: 'Linear',
      organizationId: 'org-1',
      createdById: 'user-1',
      connectionData: { secret: 'sk-123' },
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe('cred-1')

    const row = insertedValues[0]?.values
    expect(row?.type).toBe('mcp-connection')
    expect(row?.appId).toBeNull()
    expect(row?.userId).toBeNull()
    expect(row?.mcpServerId).toBe('srv-1')
    expect(row?.name).toBe('Linear Connection')
    expect(String(row?.encryptedData)).toContain('enc:')
  })

  it('updates in place when connectionId is provided (reconnect)', async () => {
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
    expect(insertedValues.length).toBe(0)
    expect(updatedValues[0]?.values.encryptedData).toContain('enc:')
    expect(updatedValues[0]?.values.expiresAt).toBeInstanceOf(Date)
  })
})

describe('resolveMcpConnectionForRuntime', () => {
  it('returns the decrypted secret on the happy path', async () => {
    queryStubs.connectionDefinition = { connectionType: 'secret' }
    queryStubs.workflowCredential = {
      id: 'cred-1',
      encryptedData: `enc:${JSON.stringify({ secret: 'sk-123', metadata: { a: 1 } })}`,
    }

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

  it('returns a none connection without a credential lookup', async () => {
    queryStubs.connectionDefinition = { connectionType: 'none' }
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
    queryStubs.workflowCredential = null
    const result = await resolveMcpConnectionForRuntime({
      mcpServerId: 'srv-1',
      organizationId: 'org-1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('CONNECTION_NOT_FOUND')
  })
})
