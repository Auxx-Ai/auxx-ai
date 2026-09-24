// packages/lib/src/ai/providers/typesafe/__tests__/typesafe-visibility.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const cache = vi.hoisted(() => ({ configurations: {} as Record<string, unknown> }))

vi.mock('../../../../cache/singletons', () => ({
  getOrgCache: () => ({
    get: async (_orgId: string, key: string) =>
      key === 'aiProviderConfigs' ? cache.configurations : {},
  }),
}))
vi.mock('../../config/limited-use', () => ({ isOrgLimitedUseGated: async () => false }))

import { getAllProviders } from '../../../../connections/providers/provider-registry'
import { getUnifiedModelData } from '../../config/cache'
import { ProviderRegistry } from '../../provider-registry'

function config(provider: string) {
  return { provider, statusInfo: { configured: true }, models: [] }
}

const ctx = { db: {} as never, organizationId: 'org', userId: 'user' }

describe('internal provider visibility', () => {
  beforeEach(() => {
    cache.configurations = { openai: config('openai'), typesafe: config('typesafe') }
  })

  it('flags typesafe as internal and nothing else', () => {
    expect(ProviderRegistry.isInternalProvider('typesafe')).toBe(true)
    expect(ProviderRegistry.isInternalProvider('openai')).toBe(false)
  })

  it('getUnifiedModelData hides internal providers by default', async () => {
    const { providers } = await getUnifiedModelData(ctx, { includeUnconfigured: true })
    expect(providers.map((p) => p.provider)).toEqual(['openai'])
  })

  it('getUnifiedModelData keeps them with includeInternal', async () => {
    const { providers } = await getUnifiedModelData(ctx, {
      includeUnconfigured: true,
      includeInternal: true,
    })
    expect(providers.map((p) => p.provider).sort()).toEqual(['openai', 'typesafe'])
  })

  it('leaves the typesafeApi blueprint out of the connect catalog', () => {
    expect(getAllProviders().some((d) => d.providerKey === 'typesafeApi')).toBe(false)
    expect(getAllProviders().some((d) => d.providerKey === 'zaiApi')).toBe(true)
  })
})
