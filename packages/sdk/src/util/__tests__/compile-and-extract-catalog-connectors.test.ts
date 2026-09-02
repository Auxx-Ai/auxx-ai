// packages/sdk/src/util/__tests__/compile-and-extract-catalog-connectors.test.ts

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { isComplete, isErrored } from '../../errors.js'
import { compileAndExtractCatalog } from '../compile-and-extract-catalog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', '..', '__fixtures__', 'connector-app')

describe('compileAndExtractCatalog — entities + data connectors', () => {
  let originalCwd: string

  beforeAll(() => {
    originalCwd = process.cwd()
    process.chdir(FIXTURE_DIR)
  })

  afterAll(() => {
    process.chdir(originalCwd)
  })

  it('projects app.entities into catalog.entities', async () => {
    const result = await compileAndExtractCatalog()
    expect(isComplete(result)).toBe(true)
    if (!isComplete(result) || !result.value) {
      throw new Error('catalog extraction returned no value')
    }
    const catalog = result.value

    expect(() => JSON.stringify(catalog)).not.toThrow()

    expect(catalog.entities).toHaveLength(3)
    const byKey = new Map((catalog.entities ?? []).map((e) => [e.key, e]))

    const orders = byKey.get('orders')
    expect(orders).toMatchObject({
      key: 'orders',
      apiSlug: 'shopify_orders',
      singular: 'Shopify Order',
      plural: 'Shopify Orders',
      primaryDisplayField: 'name',
    })
    const orderFieldsByKey = new Map((orders?.fields ?? []).map((f) => [f.key, f]))
    expect(orderFieldsByKey.get('shopifyId')).toMatchObject({ type: 'TEXT', identity: true })
    expect(orderFieldsByKey.get('customer')).toMatchObject({
      type: 'RELATIONSHIP',
      relationship: {
        target: { entityKind: 'contact' },
        cardinality: 'belongs_to',
        inverseName: 'Orders',
      },
    })
    expect(orderFieldsByKey.get('lineItems')).toMatchObject({
      type: 'RELATIONSHIP',
      relationship: {
        target: { entityKey: 'line_items' },
        cardinality: 'has_many',
        inverseName: 'Order',
      },
    })

    const lineItems = byKey.get('line_items')
    expect(lineItems).toMatchObject({ key: 'line_items', apiSlug: 'shopify_line_items' })
    const lineItemFieldsByKey = new Map((lineItems?.fields ?? []).map((f) => [f.key, f]))
    expect(lineItemFieldsByKey.get('product')).toMatchObject({
      type: 'RELATIONSHIP',
      relationship: { target: { entityKey: 'products' }, cardinality: 'belongs_to' },
    })

    expect(byKey.get('products')).toMatchObject({ key: 'products', apiSlug: 'shopify_products' })
  })

  it('projects the manifest field the connector fills via connectionFields', async () => {
    const result = await compileAndExtractCatalog()
    if (!isComplete(result) || !result.value)
      throw new Error('catalog extraction returned no value')
    const catalog = result.value

    expect(catalog.fields).toHaveLength(1)
    expect(catalog.fields?.[0]).toMatchObject({
      key: 'storeDomain',
      targetEntity: 'contact',
      scope: 'connection',
    })
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
      description: 'Sync orders and customers from Shopify.',
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

    expect(connector?.streams).toHaveLength(1)
    const stream = connector?.streams[0]
    expect(stream).toMatchObject({
      key: 'order',
      webhookTrigger: { filter: { topic: 'orders/updated' }, paths: ['resourceId'] },
    })
    // Layer A `fields` is gone — the platform builds it from mapping source paths.
    expect(stream).not.toHaveProperty('fields')
    expect(stream).not.toHaveProperty('displayFieldKey')

    const mappings = stream?.mappings ?? []
    expect(mappings).toHaveLength(4)

    // Owned root mapping — fields normalized with type/name/identity copied
    // from the `orders` entity, plus sourcePath.
    expect(mappings[0]).toMatchObject({ rootPath: '', target: { entityKey: 'orders' } })
    const ownedFieldsByKey = new Map((mappings[0]?.fields ?? []).map((f: any) => [f.key, f]))
    expect(ownedFieldsByKey.get('shopifyId')).toMatchObject({
      type: 'TEXT',
      identity: true,
      sourcePath: 'id',
    })
    expect(ownedFieldsByKey.get('totalPrice')).toMatchObject({
      type: 'CURRENCY',
      sourcePath: 'total_price',
    })

    // Contributing customer mapping — target/appField bindings + connectionFields.
    expect(mappings[1]).toMatchObject({
      rootPath: 'customer',
      relationshipFieldKey: 'customer',
      target: { entityKind: 'contact' },
      fields: [
        { sourcePath: 'email', target: 'primary_email', match: true, mergeStrategy: 'fill_blank' },
        { sourcePath: 'first_name', target: 'first_name' },
      ],
      connectionFields: [{ appField: 'storeDomain', from: 'label' }],
    })

    // Owned line_items mapping.
    expect(mappings[2]).toMatchObject({
      rootPath: 'line_items[]',
      relationshipFieldKey: 'lineItems',
      target: { entityKey: 'line_items' },
    })
    const lineItemFieldsByKey = new Map((mappings[2]?.fields ?? []).map((f: any) => [f.key, f]))
    expect(lineItemFieldsByKey.get('sku')).toMatchObject({ type: 'TEXT', sourcePath: 'sku' })

    // Reference-only mapping — no fields, just the link.
    expect(mappings[3]).toMatchObject({
      rootPath: 'line_items[].product_id',
      linkMode: 'reference',
      relationshipFieldKey: 'product',
      target: { entityKey: 'products' },
    })
    expect(mappings[3]).not.toHaveProperty('fields')

    // exampleRecord rides the catalog verbatim.
    expect(stream?.exampleRecord).toMatchObject({
      name: '#1001',
      financial_status: 'paid',
      customer: { email: 'jane@example.com' },
    })
  })
})

/**
 * Hard-error scenarios — each writes a minimal, self-contained `app.ts` to a
 * throwaway temp directory (no zod / server-file imports needed, so the temp
 * dir doesn't need its own `node_modules`: `@auxx/sdk/*` specifiers are
 * intercepted by the extractor's esbuild plugin regardless of location) and
 * asserts `compileAndExtractCatalog` refuses it with `CATALOG_VALIDATION_FAILED`.
 */
describe('compileAndExtractCatalog — connector/entity hard errors', () => {
  let tempDir: string
  let originalCwd: string

  async function runApp(source: string) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auxx-catalog-hard-errors-'))
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'src', 'app.ts'), source, 'utf8')
    originalCwd = process.cwd()
    process.chdir(tempDir)
    return compileAndExtractCatalog()
  }

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('rejects a connector mapping targeting an unknown entityKey', async () => {
    const result = await runApp(`
      import { defineEntity } from '@auxx/sdk/entities'
      import { defineDataConnector } from '@auxx/sdk/data-connectors'

      const orders = defineEntity({
        key: 'orders', apiSlug: 'orders', singular: 'Order', plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [{ key: 'name', type: 'TEXT', name: 'Name' }],
      })

      export const app = {
        entities: [orders],
        dataConnectors: [defineDataConnector({
          id: 'test.connector',
          label: 'Test',
          requiresConnection: false,
          streams: [{
            key: 'thing',
            mappings: [{ rootPath: '', target: { entityKey: 'bogus' },
              fields: [{ key: 'name', sourcePath: 'name' }] }],
          }],
          execute: async () => ({ records: [], nextState: {} }),
        })],
      }
    `)
    expect(isErrored(result)).toBe(true)
    if (!isErrored(result)) throw new Error('expected error')
    expect(result.error).toMatchObject({ code: 'CATALOG_VALIDATION_FAILED' })
    expect((result.error as { message: string }).message).toMatch(/unknown entityKey "bogus"/)
  })

  it('rejects an owned mapping field key not declared on the target entity', async () => {
    const result = await runApp(`
      import { defineEntity } from '@auxx/sdk/entities'
      import { defineDataConnector } from '@auxx/sdk/data-connectors'

      const orders = defineEntity({
        key: 'orders', apiSlug: 'orders', singular: 'Order', plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [{ key: 'name', type: 'TEXT', name: 'Name' }],
      })

      export const app = {
        entities: [orders],
        dataConnectors: [defineDataConnector({
          id: 'test.connector',
          label: 'Test',
          requiresConnection: false,
          streams: [{
            key: 'thing',
            mappings: [{ rootPath: '', target: { entityKey: 'orders' },
              fields: [{ key: 'nope', sourcePath: 'x' }] }],
          }],
          execute: async () => ({ records: [], nextState: {} }),
        })],
      }
    `)
    expect(isErrored(result)).toBe(true)
    if (!isErrored(result)) throw new Error('expected error')
    expect((result.error as { message: string }).message).toMatch(
      /owned field key "nope" is not declared on entity "orders"/
    )
  })

  it('rejects a contributing appField that is not a declared field', async () => {
    const result = await runApp(`
      import { defineDataConnector } from '@auxx/sdk/data-connectors'

      export const app = {
        dataConnectors: [defineDataConnector({
          id: 'test.connector',
          label: 'Test',
          requiresConnection: false,
          streams: [{
            key: 'thing',
            mappings: [{ rootPath: 'customer', target: { entityKind: 'contact' },
              fields: [{ sourcePath: 'id', appField: 'missing' }] }],
          }],
          execute: async () => ({ records: [], nextState: {} }),
        })],
      }
    `)
    expect(isErrored(result)).toBe(true)
    if (!isErrored(result)) throw new Error('expected error')
    expect((result.error as { message: string }).message).toMatch(
      /appField "missing" is not a declared field on "contact"/
    )
  })

  it('rejects a contributing target naming a reserved system attribute', async () => {
    const result = await runApp(`
      import { defineDataConnector } from '@auxx/sdk/data-connectors'

      export const app = {
        dataConnectors: [defineDataConnector({
          id: 'test.connector',
          label: 'Test',
          requiresConnection: false,
          streams: [{
            key: 'thing',
            mappings: [{ rootPath: '', target: { entityKind: 'contact' },
              fields: [{ sourcePath: 'id', target: 'record_id' }] }],
          }],
          execute: async () => ({ records: [], nextState: {} }),
        })],
      }
    `)
    expect(isErrored(result)).toBe(true)
    if (!isErrored(result)) throw new Error('expected error')
    expect((result.error as { message: string }).message).toMatch(
      /target "record_id" is a reserved system attribute/
    )
  })

  it('rejects connectionFields targeting an identity field', async () => {
    const result = await runApp(`
      import { defineFields } from '@auxx/sdk/fields'
      import { defineDataConnector } from '@auxx/sdk/data-connectors'

      export const app = {
        fields: defineFields([
          { key: 'customerId', type: 'TEXT', targetEntity: 'contact', scope: 'connection',
            name: 'Customer id', identity: true },
        ]),
        dataConnectors: [defineDataConnector({
          id: 'test.connector',
          label: 'Test',
          requiresConnection: false,
          streams: [{
            key: 'thing',
            mappings: [{ rootPath: '', target: { entityKind: 'contact' },
              connectionFields: [{ appField: 'customerId', from: 'label' }] }],
          }],
          execute: async () => ({ records: [], nextState: {} }),
        })],
      }
    `)
    expect(isErrored(result)).toBe(true)
    if (!isErrored(result)) throw new Error('expected error')
    expect((result.error as { message: string }).message).toMatch(
      /connectionFields "customerId" targets an identity field/
    )
  })

  it('rejects more than one identity field targeting the same entity across defineFields calls', async () => {
    const result = await runApp(`
      import { defineFields } from '@auxx/sdk/fields'

      export const app = {
        fields: defineFields([
          { key: 'a', type: 'TEXT', targetEntity: 'contact', scope: 'connection', name: 'A', identity: true },
          { key: 'b', type: 'TEXT', targetEntity: 'contact', scope: 'connection', name: 'B', identity: true },
        ]),
      }
    `)
    expect(isErrored(result)).toBe(true)
    if (!isErrored(result)) throw new Error('expected error')
    expect((result.error as { message: string }).message).toMatch(
      /More than one identity field targets "contact"/
    )
  })

  it('rejects an entity relationship targeting an unknown entityKey', async () => {
    const result = await runApp(`
      import { defineEntity } from '@auxx/sdk/entities'

      const orders = defineEntity({
        key: 'orders', apiSlug: 'orders', singular: 'Order', plural: 'Orders',
        primaryDisplayField: 'name',
        fields: [
          { key: 'name', type: 'TEXT', name: 'Name' },
          { key: 'rel', type: 'RELATIONSHIP', name: 'Rel',
            relationship: { target: { entityKey: 'missing' }, cardinality: 'belongs_to' } },
        ],
      })

      export const app = { entities: [orders] }
    `)
    expect(isErrored(result)).toBe(true)
    if (!isErrored(result)) throw new Error('expected error')
    expect((result.error as { message: string }).message).toMatch(
      /relationship target entityKey "missing" is not a declared entity/
    )
  })
})
