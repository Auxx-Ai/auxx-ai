// packages/lib/src/entity-templates/org-templates.test.ts
// Covers the org-aware resolver (app-fields-and-entities-plan Phase 2): the static
// gallery merges with templates projected from the org's installed apps' declared
// entities (`catalog.entities`), and `app:*` ids resolve only when an installed app
// declares them.

import type { CatalogEntity } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCachedInstalledApps = vi.fn()
vi.mock('../cache', () => ({
  getCachedInstalledApps: (...args: unknown[]) => getCachedInstalledApps(...args),
}))

import {
  getOrgTemplateSummaries,
  resolveOrgTemplateById,
  resolveOrgTemplatesByIds,
} from './org-templates'

const ORDERS_ENTITY: CatalogEntity = {
  key: 'orders',
  apiSlug: 'shopify_orders',
  singular: 'Order',
  plural: 'Orders',
  primaryDisplayField: 'name',
  fields: [{ key: 'name', type: 'TEXT', name: 'Order Name' }],
}

const INSTALLED_APP = {
  app: { slug: 'shopify', title: 'Shopify' },
  entities: [ORDERS_ENTITY],
}

describe('org-aware template resolution', () => {
  beforeEach(() => {
    getCachedInstalledApps.mockReset()
  })

  it('merges app-projected summaries with the static gallery', async () => {
    getCachedInstalledApps.mockResolvedValue([INSTALLED_APP])
    const summaries = await getOrgTemplateSummaries('org_1')
    const ids = summaries.map((s) => s.id)
    expect(ids).toContain('app:shopify:orders')
    // Static gallery templates still present.
    expect(ids).toContain('shipment')
  })

  it('resolves an app template id from the installed-app catalog', async () => {
    getCachedInstalledApps.mockResolvedValue([INSTALLED_APP])
    const template = await resolveOrgTemplateById('org_1', 'app:shopify:orders')
    expect(template?.entity.sourceKey).toBe('orders')
  })

  it('returns null for an app id no installed app declares', async () => {
    getCachedInstalledApps.mockResolvedValue([])
    expect(await resolveOrgTemplateById('org_1', 'app:nope:thing')).toBeNull()
  })

  it('resolves a static template id WITHOUT reading installed apps', async () => {
    const result = await resolveOrgTemplatesByIds('org_1', ['shipment'])
    expect(result.map((t) => t.id)).toEqual(['shipment'])
    expect(getCachedInstalledApps).not.toHaveBeenCalled()
  })

  it('resolves a mixed static + app install set in request order', async () => {
    getCachedInstalledApps.mockResolvedValue([INSTALLED_APP])
    const result = await resolveOrgTemplatesByIds('org_1', ['shipment', 'app:shopify:orders'])
    expect(result.map((t) => t.id)).toEqual(['shipment', 'app:shopify:orders'])
  })
})
