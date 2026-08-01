// packages/lib/src/identity/__tests__/view.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCachedInstalledApps = vi.fn()
const getCachedCustomFields = vi.fn()
vi.mock('../../cache', () => ({
  getCachedInstalledApps: (...args: unknown[]) => getCachedInstalledApps(...args),
  getCachedCustomFields: (...args: unknown[]) => getCachedCustomFields(...args),
}))

import { decorateRecordIdentities } from '../view'

function row(overrides: Record<string, unknown>) {
  return {
    id: 'ri_1',
    organizationId: 'org_1',
    entityInstanceId: 'inst_1',
    entityDefinitionId: 'def_contact',
    source: 'shopify',
    appInstallationId: null,
    connectionId: null,
    appFieldKey: null,
    fieldId: null,
    externalId: 'x',
    createdAt: new Date('2026-06-30T00:00:00Z'),
    updatedAt: new Date('2026-06-30T00:00:00Z'),
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  getCachedInstalledApps.mockResolvedValue([
    {
      installationId: 'inst_shopify',
      app: { title: 'Shopify', avatarUrl: 'https://icon/shopify' },
    },
  ])
  getCachedCustomFields.mockResolvedValue([{ id: 'field_cust', name: 'Shopify customer ID' }])
})

describe('decorateRecordIdentities', () => {
  it('decorates an app-backed identity from installed-apps + custom-fields cache', async () => {
    const [view] = await decorateRecordIdentities('org_1', [
      row({
        id: 'ri_shopify',
        source: 'shopify',
        appInstallationId: 'inst_shopify',
        connectionId: 'conn_us',
        appFieldKey: 'customerId',
        fieldId: 'field_cust',
        externalId: '207119551',
      }),
    ])

    expect(view).toEqual({
      id: 'ri_shopify',
      source: 'shopify',
      appName: 'Shopify',
      appIconKey: 'https://icon/shopify',
      connectionId: 'conn_us',
      connectionLabel: null,
      appFieldKey: 'customerId',
      fieldLabel: 'Shopify customer ID',
      externalId: '207119551',
      updatedAt: '2026-06-30T00:00:00.000Z',
    })
  })

  it('labels the app-less chat link "Chat" with no icon or field label', async () => {
    const [view] = await decorateRecordIdentities('org_1', [
      row({ id: 'ri_chat', source: 'chat', externalId: 'visitor_1' }),
    ])

    expect(view?.appName).toBe('Chat')
    expect(view?.appIconKey).toBeNull()
    expect(view?.fieldLabel).toBeNull()
    expect(view?.appFieldKey).toBeNull()
  })

  it('sorts by source then externalId for a stable card order', async () => {
    const views = await decorateRecordIdentities('org_1', [
      row({ id: 'b', source: 'shopify', externalId: '2' }),
      row({ id: 'a', source: 'chat', externalId: 'z' }),
      row({ id: 'c', source: 'shopify', externalId: '1' }),
    ])
    expect(views.map((v) => v.id)).toEqual(['a', 'c', 'b'])
  })

  it('returns an empty array without hitting the cache when given no rows', async () => {
    const views = await decorateRecordIdentities('org_1', [])
    expect(views).toEqual([])
    expect(getCachedInstalledApps).not.toHaveBeenCalled()
  })

  it('falls back to null app metadata when the installation is unknown (uninstalled)', async () => {
    const [view] = await decorateRecordIdentities('org_1', [
      row({ id: 'ri_gone', source: 'hubspot', appInstallationId: 'inst_missing' }),
    ])
    expect(view?.appName).toBeNull()
    expect(view?.appIconKey).toBeNull()
  })
})
