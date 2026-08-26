// packages/lib/src/admin/__tests__/export-import-round-trip.test.ts
//
// The export/import pair is three hand-maintained projections of one row:
// `export-apps.ts`'s per-connection object literal, `import-apps.ts`'s `ExportData`
// type + `connFields`, and the zod `connectionDefinitionSchema` in
// `apps/web/src/server/api/routers/admin-apps.ts`. A column added to
// `ConnectionDefinition` reaches none of them automatically, and a field missing from
// any one is dropped in silence — that is how `key`, `connectionVariables`, `authApply`
// and `baseUrlTemplate` were each lost (see the comment at admin-apps.ts:24).
//
// These tests cover the two lib-side legs for `oauth2OptionalScopes`. The zod leg is
// covered separately by `apps/web/src/server/api/routers/admin-apps-schema.test.ts`.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/credentials/crypto', () => ({
  encryptValue: (value: string) => `enc(${value})`,
  decryptValue: (value: string | null) => value,
}))

vi.mock('../../cache/app-cache-helpers', () => ({
  getCachedAppBySlug: async () => null,
}))

import { exportByDeveloperAccount } from '../export-apps'
import { type ExportData, importApps } from '../import-apps'

const CONNECTION_ROW = {
  key: 'default',
  connectionType: 'oauth2-code',
  label: 'Shopify',
  description: null,
  global: false,
  major: 1,
  oauth2AuthorizeUrl: 'https://example.test/authorize',
  oauth2AccessTokenUrl: 'https://example.test/token',
  oauth2ClientId: 'client-id',
  oauth2ClientSecret: 'secret',
  oauth2Scopes: ['read_orders'],
  oauth2OptionalScopes: ['read_all_orders'],
  oauth2TokenRequestAuthMethod: 'client_secret_post',
  oauth2RefreshTokenIntervalSeconds: null,
  oauth2Features: null,
  connectionVariables: [],
  authApply: null,
  baseUrlTemplate: null,
}

function exportDb() {
  return {
    query: {
      DeveloperAccount: {
        findFirst: async () => ({ slug: 'acme', title: 'Acme', featureFlags: null }),
      },
      App: {
        findMany: async () => [
          {
            slug: 'shopify',
            title: 'Shopify',
            hasBundle: false,
            oauthApplication: null,
            connectionDefinitions: [CONNECTION_ROW],
            deployments: [],
          },
        ],
      },
    },
  } as never
}

/** Captures every value object handed to `insert(...)`. */
function importDb(inserts: Array<Record<string, unknown>>) {
  const tx = {
    query: {
      DeveloperAccount: { findFirst: async () => ({ id: 'dev_1', slug: 'acme' }) },
      oauthApplication: { findFirst: async () => undefined },
      App: { findFirst: async () => undefined },
      ConnectionDefinition: { findFirst: async () => undefined },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values)
        const result: Promise<Array<{ id: string }>> & { returning?: unknown } = Promise.resolve([
          { id: 'row_1' },
        ])
        result.returning = () => Promise.resolve([{ id: 'row_1' }])
        return result
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }

  return {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  } as never
}

/** The connection-definition inserts, identified by a column only that table carries. */
function connectionInserts(inserts: Array<Record<string, unknown>>) {
  return inserts.filter((values) => 'oauth2Scopes' in values)
}

const IMPORT_OPTIONS = {
  targetDeveloperAccountId: 'dev_1',
  selectedSlugs: ['shopify'],
  slugOverrides: {},
}

describe('export/import round-trip — oauth2OptionalScopes', () => {
  it('the exporter emits oauth2OptionalScopes beside oauth2Scopes', async () => {
    const result = await exportByDeveloperAccount(exportDb(), 'dev_1')

    const [connection] = result.apps[0]!.connectionDefinitions
    expect(connection).toMatchObject({
      oauth2Scopes: ['read_orders'],
      oauth2OptionalScopes: ['read_all_orders'],
    })
  })

  it('survives export then import — the additive list reaches the insert', async () => {
    const exported = (await exportByDeveloperAccount(exportDb(), 'dev_1')) as unknown as ExportData

    const inserts: Array<Record<string, unknown>> = []
    await importApps(importDb(inserts), exported, 'user_1', IMPORT_OPTIONS)

    const connections = connectionInserts(inserts)
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({
      oauth2Scopes: ['read_orders'],
      oauth2OptionalScopes: ['read_all_orders'],
    })
  })

  it('an export predating the field imports as [] rather than NULL', async () => {
    const exported = (await exportByDeveloperAccount(exportDb(), 'dev_1')) as unknown as ExportData
    // Model a key that is absent from the file, not merely null.
    delete exported.apps[0]!.connectionDefinitions[0]!.oauth2OptionalScopes

    const inserts: Array<Record<string, unknown>> = []
    await importApps(importDb(inserts), exported, 'user_1', IMPORT_OPTIONS)

    expect(connectionInserts(inserts)[0]!.oauth2OptionalScopes).toEqual([])
  })
})
