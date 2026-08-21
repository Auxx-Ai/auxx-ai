// packages/lib/src/entity-templates/template-installer.test.ts
// Covers the connector-aware install stamping (v6): a template installed WITH an
// install context stamps the def's `sourceKey` + owner FKs and each field's
// `appFieldKey` + owner FKs, so the installed def is connector-/app-owned and
// idempotent per `(owner, sourceKey | appFieldKey)`.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../entity-definitions', () => ({
  createEntityDefinition: vi.fn(),
  checkSlugExists: vi.fn(),
}))
vi.mock('../custom-fields', () => ({ createCustomField: vi.fn() }))
vi.mock('../cache/invalidate', () => ({ onCacheEvent: vi.fn() }))

import { createCustomField } from '../custom-fields'
import { checkSlugExists, createEntityDefinition } from '../entity-definitions'
import { installTemplates } from './template-installer'
import type { EntityTemplate } from './types'

const APP_TEMPLATE: EntityTemplate = {
  id: 'app:shopify:orders',
  name: 'Order',
  description: 'Orders synced from the Shopify app.',
  categories: ['app'],
  entity: {
    apiSlug: 'shopify_orders',
    singular: 'Order',
    plural: 'Orders',
    icon: 'box',
    color: 'blue',
    sourceKey: 'orders',
  },
  primaryDisplayField: 'name',
  fields: [
    {
      templateFieldId: 'name',
      appFieldKey: 'name',
      name: 'Order Name',
      type: 'TEXT',
      isUpdatable: false,
      isCreatable: false,
    },
  ],
}

describe('installTemplates — connector-aware stamping', () => {
  beforeEach(() => {
    vi.mocked(checkSlugExists).mockResolvedValue(ok(false))
    vi.mocked(createEntityDefinition).mockResolvedValue(ok({ id: 'def_orders' } as never))
    vi.mocked(createCustomField).mockResolvedValue(ok({ id: 'field_name' } as never))
  })

  it('stamps sourceKey + owner FKs on the created def', async () => {
    await installTemplates('org_1', ['app:shopify:orders'], {
      resolveTemplates: async () => [APP_TEMPLATE],
      installContext: { dataConnectorId: 'dc_1', appInstallationId: 'ai_1' },
    })
    expect(createEntityDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'orders',
        appInstallationId: 'ai_1',
        dataConnectorId: 'dc_1',
      })
    )
  })

  it('stamps appFieldKey + owner FKs + systemAttribute on each field', async () => {
    await installTemplates('org_1', ['app:shopify:orders'], {
      resolveTemplates: async () => [APP_TEMPLATE],
      installContext: { dataConnectorId: 'dc_1', appInstallationId: 'ai_1' },
    })
    expect(createCustomField).toHaveBeenCalledWith(
      expect.objectContaining({
        appFieldKey: 'name',
        dataConnectorId: 'dc_1',
        appInstallationId: 'ai_1',
        systemAttribute: 'name',
      })
    )
  })

  it('falls back to templateId for sourceKey and stamps no owner without context', async () => {
    const staticTemplate: EntityTemplate = {
      ...APP_TEMPLATE,
      id: 'product',
      entity: { ...APP_TEMPLATE.entity, sourceKey: undefined },
    }
    await installTemplates('org_1', ['product'], {
      resolveTemplates: async () => [staticTemplate],
    })
    expect(createEntityDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'product',
        appInstallationId: undefined,
        dataConnectorId: undefined,
      })
    )
  })

  it('throws when no templates resolve', async () => {
    await expect(
      installTemplates('org_1', ['missing'], { resolveTemplates: async () => [] })
    ).rejects.toThrow('No valid templates found')
    expect(createEntityDefinition).not.toHaveBeenCalled()
  })

  it('surfaces a def creation failure', async () => {
    vi.mocked(createEntityDefinition).mockResolvedValue(
      err({ code: 'SLUG_ALREADY_EXISTS', message: 'taken' } as never)
    )
    await expect(
      installTemplates('org_1', ['app:shopify:orders'], {
        resolveTemplates: async () => [APP_TEMPLATE],
        installContext: { dataConnectorId: 'dc_1', appInstallationId: 'ai_1' },
      })
    ).rejects.toThrow('Failed to create entity')
  })
})
