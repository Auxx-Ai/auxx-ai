// packages/lib/src/cache/__tests__/installed-apps-provider-scopes.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { ORG_CACHE_KEY_CONFIG } from '../org-cache-keys'
import { installedAppsProvider } from '../providers/installed-apps-provider'

/** Minimal db double: the two relational reads plus the batched credential select. */
function makeFakeDb(installations: unknown[], connectionDefs: unknown[]): Database {
  const selectChain = (resolved: unknown[]) => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return Promise.resolve(resolved).then.bind(Promise.resolve(resolved))
          return () => proxy
        },
      }
    )
    return proxy
  }
  return {
    query: {
      AppInstallation: { findMany: async () => installations },
      ConnectionDefinition: { findMany: async () => connectionDefs },
    },
    select: () => selectChain([]),
  } as unknown as Database
}

const INSTALLATION = {
  id: 'inst_1',
  installationType: 'production',
  installedAt: new Date('2026-01-01'),
  app: {
    id: 'app_1',
    slug: 'shopify',
    title: 'Shopify',
    description: null,
    avatarUrl: null,
    category: null,
  },
  currentDeployment: null,
}

function connectionDef(overrides: Record<string, unknown>) {
  return {
    id: 'cd_1',
    key: 'oauth',
    appId: 'app_1',
    label: 'Shopify store',
    description: null,
    global: true,
    connectionType: 'oauth2-code',
    oauth2Features: {},
    connectionVariables: [],
    oauth2ClientId: null,
    oauth2ClientSecret: null,
    platformClientApproved: true,
    ...overrides,
  }
}

/** The third-party row — index 0 is the synthetic built-in `auxx` row. */
async function methodsFor(def: Record<string, unknown>) {
  const rows = await installedAppsProvider.compute(
    'org_1',
    makeFakeDb([INSTALLATION], [connectionDef(def)])
  )
  return rows.find((r) => r.app.id === 'app_1')?.methods ?? []
}

describe('installedAppsProvider methods[] scope projection', () => {
  it('carries the scope floor and the additive optional list', async () => {
    const [method] = await methodsFor({
      oauth2Scopes: ['read_orders', 'write_orders'],
      oauth2OptionalScopes: ['read_all_orders'],
    })

    expect(method?.oauth2Scopes).toEqual(['read_orders', 'write_orders'])
    expect(method?.oauth2OptionalScopes).toEqual(['read_all_orders'])
  })

  it('defaults both to [] when the columns are null', async () => {
    const [method] = await methodsFor({ oauth2Scopes: null, oauth2OptionalScopes: null })

    expect(method?.oauth2Scopes).toEqual([])
    expect(method?.oauth2OptionalScopes).toEqual([])
  })
})

describe('installedApps cache prefix', () => {
  // The projection above changed shape, so a stale blob under the previous prefix would
  // make every installed app read as declaring no optional scopes for the full 900 s TTL.
  it('is bumped to v8', () => {
    expect(ORG_CACHE_KEY_CONFIG.installedApps.prefix).toBe('org:installed-apps:v8')
  })
})
