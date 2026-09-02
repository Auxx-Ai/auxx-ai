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

// `installTemplates`'s linked-entity guard (§4.4 of the app-fields-and-entities plan)
// looks up the link target's row, so `@auxx/database` needs a controllable
// `query.EntityDefinition.findFirst` here — the global `src/test/setup.ts` mock only
// stubs `query.user`/`query.organization`. Replicates the rest of that mock's shape
// (chainable select/insert/update/delete, an auto-vivifying `schema` proxy) so the
// existing tests below — which never touch `EntityDefinition`-linking — keep working.
const findFirstEntityDefinition = vi.fn()

function createChainableMock(): any {
  const mock: any = vi.fn(() => mock)
  mock.from = vi.fn(() => mock)
  mock.where = vi.fn(() => mock)
  mock.set = vi.fn(() => mock)
  mock.values = vi.fn(() => mock)
  mock.returning = vi.fn(() => mock)
  mock.then = undefined
  return mock
}

vi.mock('@auxx/database', () => ({
  database: {
    select: vi.fn(() => createChainableMock()),
    insert: vi.fn(() => createChainableMock()),
    update: vi.fn(() => createChainableMock()),
    delete: vi.fn(() => createChainableMock()),
    query: {
      EntityDefinition: {
        findFirst: (...args: unknown[]) => findFirstEntityDefinition(...args),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  },
  schema: new Proxy({} as Record<string, object>, {
    get: (target, key: string) => {
      if (!(key in target)) target[key] = {}
      return target[key]
    },
  }),
}))

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
    {
      templateFieldId: 'shopifyId',
      appFieldKey: 'shopifyId',
      name: 'Shopify Order ID',
      type: 'TEXT',
      isIdentity: true,
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

  it('stamps installContext.appSlug + the field-carried isIdentity on the owned identity column', async () => {
    await installTemplates('org_1', ['app:shopify:orders'], {
      resolveTemplates: async () => [APP_TEMPLATE],
      installContext: { dataConnectorId: 'dc_1', appInstallationId: 'ai_1', appSlug: 'shopify' },
    })
    expect(createCustomField).toHaveBeenCalledWith(
      expect.objectContaining({
        appFieldKey: 'shopifyId',
        isIdentity: true,
        appSlug: 'shopify',
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

/** A RELATIONSHIP-bearing template, the shape a "link to existing entity" install plants. */
const LINKED_RELATIONSHIP_TEMPLATE: EntityTemplate = {
  id: 'app:shopify:line_items',
  name: 'Line Item',
  description: 'Line items synced from the Shopify app.',
  categories: ['app'],
  entity: {
    apiSlug: 'shopify_line_items',
    singular: 'Line Item',
    plural: 'Line Items',
    icon: 'box',
    color: 'blue',
    sourceKey: 'line_items',
  },
  primaryDisplayField: 'sku',
  fields: [
    {
      templateFieldId: 'product',
      appFieldKey: 'product',
      name: 'Product',
      type: 'RELATIONSHIP',
      relationship: {
        relatedResourceId: 'def_product',
        relationshipType: 'belongs_to',
        inverseName: 'Line Items',
      },
    },
  ],
}

describe('installTemplates — linked-entity guard (app-fields-and-entities plan §4.4)', () => {
  beforeEach(() => {
    findFirstEntityDefinition.mockReset()
    vi.mocked(createCustomField).mockResolvedValue(ok({ id: 'field_product' } as never))
  })

  const linkedEntities = {
    [LINKED_RELATIONSHIP_TEMPLATE.id]: {
      entityDefinitionId: 'def_line_items',
      newRelationshipFieldTemplateIds: ['product'],
    },
  }

  it('refuses an app install linking its template onto a system entity definition', async () => {
    findFirstEntityDefinition.mockResolvedValue({
      id: 'def_line_items',
      entityType: 'line_item',
      singular: 'Line Item',
    })

    await expect(
      installTemplates('org_1', [LINKED_RELATIONSHIP_TEMPLATE.id], {
        resolveTemplates: async () => [LINKED_RELATIONSHIP_TEMPLATE],
        linkedEntities,
        installContext: { appInstallationId: 'ai_1' },
      })
    ).rejects.toThrow(/system entity definition/i)
    expect(createCustomField).not.toHaveBeenCalled()
  })

  it('refuses a connector install linking its template onto a system entity definition', async () => {
    findFirstEntityDefinition.mockResolvedValue({
      id: 'def_line_items',
      entityType: 'line_item',
      singular: 'Line Item',
    })

    await expect(
      installTemplates('org_1', [LINKED_RELATIONSHIP_TEMPLATE.id], {
        resolveTemplates: async () => [LINKED_RELATIONSHIP_TEMPLATE],
        linkedEntities,
        installContext: { dataConnectorId: 'dc_1' },
      })
    ).rejects.toThrow(/system entity definition/i)
  })

  it('does not query or block a plain gallery link (no installContext), even onto a system def', async () => {
    findFirstEntityDefinition.mockResolvedValue({ entityType: 'line_item', singular: 'Line Item' })

    await installTemplates('org_1', [LINKED_RELATIONSHIP_TEMPLATE.id], {
      resolveTemplates: async () => [LINKED_RELATIONSHIP_TEMPLATE],
      linkedEntities,
    })

    expect(findFirstEntityDefinition).not.toHaveBeenCalled()
    expect(createCustomField).toHaveBeenCalled()
  })

  it('allows an app/connector install to link onto an ordinary user-created entity', async () => {
    findFirstEntityDefinition.mockResolvedValue({ entityType: null, singular: 'Products' })

    await expect(
      installTemplates('org_1', [LINKED_RELATIONSHIP_TEMPLATE.id], {
        resolveTemplates: async () => [LINKED_RELATIONSHIP_TEMPLATE],
        linkedEntities,
        installContext: { dataConnectorId: 'dc_1', appInstallationId: 'ai_1' },
      })
    ).resolves.toBeDefined()
    expect(createCustomField).toHaveBeenCalled()
  })

  it('plants the relationship field with appFieldKey but no systemAttribute on a linked def', async () => {
    findFirstEntityDefinition.mockResolvedValue({ entityType: null, singular: 'Products' })

    await installTemplates('org_1', [LINKED_RELATIONSHIP_TEMPLATE.id], {
      resolveTemplates: async () => [LINKED_RELATIONSHIP_TEMPLATE],
      linkedEntities,
      installContext: { dataConnectorId: 'dc_1', appInstallationId: 'ai_1' },
    })

    expect(createCustomField).toHaveBeenCalledWith(
      expect.objectContaining({
        appFieldKey: 'product',
        dataConnectorId: 'dc_1',
        appInstallationId: 'ai_1',
      })
    )
    const call = vi.mocked(createCustomField).mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >
    expect(call.systemAttribute).toBeUndefined()
  })
})
