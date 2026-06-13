// packages/lib/src/ai/mcp/templates/__tests__/ensure.test.ts
//
// The upsert contract: insert-new, update-in-place keeping the row id (McpInstallation FKs),
// and definition updates that never touch lazily-discovered OAuth URLs / DCR client creds.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (...a: unknown[]) => ({ eq: a }),
  isNull: (...a: unknown[]) => ({ isNull: a }),
}))

vi.mock('@auxx/database', () => ({
  schema: {
    McpServer: { _name: 'McpServer' },
    ConnectionDefinition: { _name: 'ConnectionDefinition' },
  },
  database: {},
}))

import type { McpTemplate } from '../catalog'
import { ensureCuratedMcpServer } from '../ensure'

const state = {
  serverRows: [] as Array<{ id: string }>,
  defRows: [] as Array<{ id: string }>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
}

const tableName = (t: unknown) => (t as { _name?: string })?._name ?? 'unknown'

/** Minimal select/insert/update chain matching exactly what ensure.ts calls. */
const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => (tableName(table) === 'McpServer' ? state.serverRows : state.defRows),
      }),
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      state.inserts.push({ table: tableName(table), values })
      const promise = Promise.resolve(undefined) as Promise<undefined> & {
        returning: () => Promise<Array<{ id: string }>>
      }
      promise.returning = async () => [{ id: 'srv-new' }]
      return promise
    },
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      state.updates.push({ table: tableName(table), values })
      return { where: async () => undefined }
    },
  }),
  // biome-ignore lint/suspicious/noExplicitAny: structural stand-in for the Drizzle Database type
} as any

const TEMPLATE: McpTemplate = {
  id: 'linear',
  name: 'Linear',
  description: 'Linear issues.',
  icon: { iconId: 'https://linear.app/favicon.ico' },
  categories: ['project-management'],
  endpoint: 'https://mcp.linear.app/mcp',
  connectionType: 'oauth2-code',
}

beforeEach(() => {
  state.serverRows = []
  state.defRows = []
  state.inserts = []
  state.updates = []
})

describe('ensureCuratedMcpServer', () => {
  it('inserts a new global server + connection definition when none exist', async () => {
    const { serverId } = await ensureCuratedMcpServer(TEMPLATE, fakeDb)

    expect(serverId).toBe('srv-new')
    const serverInsert = state.inserts.find((i) => i.table === 'McpServer')
    expect(serverInsert?.values).toMatchObject({
      organizationId: null,
      slug: 'linear',
      name: 'Linear',
      endpoint: 'https://mcp.linear.app/mcp',
      createdById: null,
    })
    const defInsert = state.inserts.find((i) => i.table === 'ConnectionDefinition')
    expect(defInsert?.values).toMatchObject({
      mcpServerId: 'srv-new',
      connectionType: 'oauth2-code',
      global: true,
      oauth2Features: { pkce: true },
      connectionVariables: [],
    })
    expect(state.updates).toHaveLength(0)
  })

  it('updates an existing server in place, keeping the row id stable', async () => {
    state.serverRows = [{ id: 'srv-existing' }]
    state.defRows = [{ id: 'def-existing' }]

    const { serverId } = await ensureCuratedMcpServer(TEMPLATE, fakeDb)

    expect(serverId).toBe('srv-existing')
    expect(state.inserts).toHaveLength(0)
    expect(state.updates.map((u) => u.table)).toEqual(['McpServer', 'ConnectionDefinition'])
  })

  it('never overwrites lazily-discovered OAuth URLs or client creds on the definition', async () => {
    state.serverRows = [{ id: 'srv-existing' }]
    state.defRows = [{ id: 'def-existing' }]

    await ensureCuratedMcpServer(TEMPLATE, fakeDb)

    const defUpdate = state.updates.find((u) => u.table === 'ConnectionDefinition')
    expect(Object.keys(defUpdate?.values ?? {}).sort()).toEqual([
      'connectionType',
      'connectionVariables',
      'label',
      'oauth2Features',
    ])
  })

  it('writes connection variables to the top-level column, not oauth2Features', async () => {
    await ensureCuratedMcpServer(
      {
        ...TEMPLATE,
        id: 'shopify',
        connectionType: 'none',
        connectionVariables: [{ key: 'shop', label: 'Shop subdomain', required: true }],
      },
      fakeDb
    )

    const defInsert = state.inserts.find((i) => i.table === 'ConnectionDefinition')
    expect(defInsert?.values.oauth2Features).toEqual({ pkce: false })
    expect(defInsert?.values.connectionVariables).toEqual([
      { key: 'shop', label: 'Shop subdomain', required: true },
    ])
  })
})
