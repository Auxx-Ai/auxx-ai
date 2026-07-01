// packages/sdk/src/util/__tests__/compile-and-extract-catalog-connectors.test.ts

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isComplete } from '../../errors.js'
import { compileAndExtractCatalog } from '../compile-and-extract-catalog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', '..', '__fixtures__', 'connector-app')

describe('compileAndExtractCatalog — data connectors', () => {
  let originalCwd: string

  beforeAll(() => {
    originalCwd = process.cwd()
    process.chdir(FIXTURE_DIR)
  })

  afterAll(() => {
    process.chdir(originalCwd)
  })

  it('projects app.dataConnectors into catalog.dataConnectors with streams + mappings', async () => {
    const result = await compileAndExtractCatalog()
    expect(isComplete(result)).toBe(true)
    if (!isComplete(result) || !result.value) {
      throw new Error('catalog extraction returned no value')
    }
    const catalog = result.value

    // Roundtrip-serializable (extractor enforces it; assert again).
    expect(() => JSON.stringify(catalog)).not.toThrow()

    expect(catalog.dataConnectors).toHaveLength(1)
    const connector = catalog.dataConnectors?.[0]
    expect(connector).toMatchObject({
      id: 'shopify.core',
      label: 'Shopify Core Data',
      requiresConnection: true,
      iconKey: 'shopping-bag',
      webhookTrigger: { triggerId: 'shopify.shopify-trigger' },
    })

    // Config schema projected from the zod schema.
    expect(connector?.configJsonSchema).toMatchObject({
      type: 'object',
      properties: { includeDraftProducts: { type: 'boolean' } },
    })

    // Tool-backed config-field hints projected beside the bare JSON Schema.
    expect(connector?.configOptionHints).toEqual({
      collection: {
        kind: 'dynamic-select',
        dynamicSelect: {
          optionsFrom: 'list_shopify_collections',
          itemsPath: 'collections',
          valuePath: 'handle',
          labelTemplate: '{handle}',
        },
      },
    })

    // One stream, with the source fields flattened (fieldKey carried).
    expect(connector?.streams).toHaveLength(1)
    const stream = connector?.streams[0]
    expect(stream).toMatchObject({
      key: 'order',
      displayFieldKey: 'name',
      webhookTrigger: { filter: { topic: 'orders/updated' }, paths: ['resourceId'] },
    })

    const byKey = new Map((stream?.fields ?? []).map((f) => [f.fieldKey, f]))
    // The declared external-id flag survives extraction onto the catalog field (the id
    // field is keyed `shopify_id` — a real owned column, not the bare `id` a def reserves).
    expect(byKey.get('shopify_id')).toMatchObject({
      sourcePath: 'id',
      type: 'TEXT',
      isExternalId: true,
    })
    // Unflagged fields don't carry it.
    expect(byKey.get('name')?.isExternalId).toBeUndefined()
    expect(byKey.get('totalPrice')).toMatchObject({ sourcePath: 'total_price', type: 'CURRENCY' })
    // PII flag survives serialization.
    expect(byKey.get('customer.email')).toMatchObject({
      sourcePath: 'customer.email',
      type: 'EMAIL',
      pii: true,
    })
    expect(byKey.get('lineItems.productId')).toMatchObject({
      sourcePath: 'line_items[].product_id',
    })

    // Recommended fan-out mappings survive serialization (root owned, customer
    // contributing, line_items owned, product_id reference).
    const mappings = stream?.defaultMappings ?? []
    expect(mappings).toHaveLength(4)
    expect(mappings[0]).toMatchObject({
      rootPath: '',
      target: { mode: 'owned', entity: { key: 'orders', apiSlug: 'shopify_orders' } },
    })
    expect(mappings[1]).toMatchObject({
      rootPath: 'customer',
      relationshipFieldKey: 'customer',
      target: {
        mode: 'contributing',
        entityKind: 'contact',
        matchFieldKeys: ['email'],
      },
    })
    // The line_items[] owned child carries the relationship provisioning decl that
    // drives auto-creation of the has_many edge (+ inverse) at materialization.
    expect(mappings[2]).toMatchObject({
      rootPath: 'line_items[]',
      relationshipFieldKey: 'lineItems',
      relationship: {
        fieldKey: 'lineItems',
        name: 'Line Items',
        cardinality: 'has_many',
        inverseName: 'Order',
      },
      target: { mode: 'owned', entity: { key: 'line_items', apiSlug: 'shopify_line_items' } },
    })
    expect(mappings[3]).toMatchObject({
      rootPath: 'line_items[].product_id',
      linkMode: 'reference',
      relationship: {
        fieldKey: 'product',
        cardinality: 'belongs_to',
        targetRef: { ownedKey: 'products' },
      },
      target: { mode: 'owned', entity: { key: 'products', apiSlug: 'shopify_products' } },
    })

    // exampleRecord rides the catalog verbatim.
    expect(stream?.exampleRecord).toMatchObject({
      name: '#1001',
      financial_status: 'paid',
      customer: { email: 'jane@example.com' },
    })
  })
})
