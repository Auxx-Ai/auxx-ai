// packages/lib/src/data-connectors/__tests__/contributing-parent-materialization.test.ts
// Contributing mappings parenting onto contributing siblings (full contribute mode):
// `'' → product` parents `variants[] → part`, and a FLAT drilled child (explicit
// `parentRootPath`, same subtree) contributes the part's `vendor_part` with a
// pre-existing SYSTEM relationship edge (`system:part_vendor_parts`) resolved at
// install to the concrete `defId:fieldId` ref the manual editor stores. DB + org
// cache are mocked; the assertions read the inserted `DataConnectorMapping` values.

import type { CatalogConnectorStream, Database } from '@auxx/database'
import { toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCachedCustomFields, getCachedEntityDefId } from '../../cache'
import {
  materializeAppContributingMappings,
  resolveContributingRelationshipFieldKey,
} from '../mutations'

vi.mock('../../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cache')>()
  return {
    ...actual,
    getCachedEntityDefId: vi.fn(),
    getCachedCustomFields: vi.fn(),
  }
})

const ORG = 'org_1'
const STREAM_ID = 'stream_1'
const APP = 'shopify'

const DEF_IDS: Record<string, string> = {
  product: 'def_product',
  part: 'def_part',
  vendor_part: 'def_vendor_part',
}

/** Minimal cached-field rows per def (id + systemAttribute drive resolution). */
const DEF_FIELDS: Record<string, Array<Record<string, unknown>>> = {
  def_product: [
    { id: 'f_title', name: 'Title', systemAttribute: 'product_title', type: 'TEXT' },
    { id: 'f_parts', name: 'Parts', systemAttribute: 'product_parts', type: 'RELATIONSHIP' },
  ],
  def_part: [
    { id: 'f_sku', name: 'SKU', systemAttribute: 'part_sku', type: 'TEXT' },
    {
      id: 'f_vp',
      name: 'Vendor Parts',
      systemAttribute: 'part_vendor_parts',
      type: 'RELATIONSHIP',
    },
  ],
  def_vendor_part: [
    {
      id: 'f_price',
      name: 'Unit Price',
      systemAttribute: 'vendor_part_unit_price',
      type: 'CURRENCY',
    },
  ],
}

/** Drizzle stub: `addMapping`'s stream-guard findFirst + insert().values().returning(). */
function mockDb() {
  const inserted: Array<Record<string, unknown>> = []
  let n = 0
  const db = {
    query: {
      DataConnectorStream: {
        findFirst: vi.fn(async () => ({ id: STREAM_ID, organizationId: ORG })),
      },
    },
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: `m_${++n}`, ...v }
          inserted.push(row)
          return [row]
        },
      }),
    })),
  }
  return { db: db as unknown as Database, inserted }
}

/** The full-contribute-mode product stream: product root + part child + flat vendor_part. */
const STREAM: CatalogConnectorStream = {
  key: 'product',
  mappings: [
    { rootPath: '', target: { entityKind: 'product' } },
    {
      rootPath: 'variants[]',
      relationshipFieldKey: 'system:product_parts',
      target: { entityKind: 'part' },
      fields: [{ sourcePath: 'sku', target: 'part_sku' }],
    },
    // The flat drilled child: same subtree as the part mapping, explicit parent.
    {
      rootPath: 'variants[]',
      parentRootPath: 'variants[]',
      relationshipFieldKey: 'system:part_vendor_parts',
      target: { entityKind: 'vendor_part' },
      fields: [{ sourcePath: 'price', target: 'vendor_part_unit_price' }],
    },
  ],
}

beforeEach(() => {
  vi.mocked(getCachedEntityDefId).mockImplementation(async (_org, kind) => DEF_IDS[kind])
  vi.mocked(getCachedCustomFields).mockImplementation(
    async (_org, defId) => (DEF_FIELDS[defId] ?? []) as never
  )
})

describe('materializeAppContributingMappings — contributing parents', () => {
  it('chains product → part → vendor_part with correct parentMappingId + stored rootPaths', async () => {
    const { db, inserted } = mockDb()
    await materializeAppContributingMappings(db, ORG, STREAM_ID, STREAM, APP)

    expect(inserted).toHaveLength(3)
    const [product, part, vendorPart] = inserted

    // Root: no parent, no edge.
    expect(product).toMatchObject({
      rootPath: '',
      targetMode: 'contributing',
      entityDefinitionId: 'def_product',
      parentMappingId: null,
      relationshipFieldKey: null,
    })

    // The part mapping parents onto the CONTRIBUTING product root (previously it
    // could only parent onto an owned mapping and became an edge-less root).
    expect(part).toMatchObject({
      rootPath: 'variants[]',
      entityDefinitionId: 'def_part',
      parentMappingId: product?.id,
    })
    // Its system edge resolved on the PARENT (product) def to the concrete ref form.
    expect(part?.relationshipFieldKey).toBe(toResourceFieldId('def_product', 'f_parts'))

    // The flat child: explicit parentRootPath, stored rootPath '' (the drilled shape
    // mapRecord fans out), parented onto the part row.
    expect(vendorPart).toMatchObject({
      rootPath: '',
      entityDefinitionId: 'def_vendor_part',
      parentMappingId: part?.id,
    })
    expect(vendorPart?.relationshipFieldKey).toBe(toResourceFieldId('def_part', 'f_vp'))
  })

  it('binds declared fields, sourcePath already relative on both siblings', async () => {
    const { db, inserted } = mockDb()
    await materializeAppContributingMappings(db, ORG, STREAM_ID, STREAM, APP)
    const [, part, vendorPart] = inserted

    const partFms = part?.fieldMappings as Array<Record<string, unknown>>
    expect(partFms.some((fm) => fm.targetFieldRef === toResourceFieldId('def_part', 'f_sku'))).toBe(
      true
    )
    expect(partFms.find((fm) => fm.targetFieldRef?.toString().endsWith('f_sku'))?.expression).toBe(
      '{sku}'
    )
    const vpFms = vendorPart?.fieldMappings as Array<Record<string, unknown>>
    // The flat child's fields are already relative to its OWN mapping (`price`), matching
    // the parent subtree its stored `''` rootPath reads.
    expect(vpFms.find((fm) => fm.targetFieldRef?.toString().endsWith('f_price'))?.expression).toBe(
      '{price}'
    )
  })

  it('still parents a nested contributing branch onto an OWNED root, with the @app: envelope', async () => {
    const { db, inserted } = mockDb()
    const orderStream: CatalogConnectorStream = {
      key: 'orders',
      mappings: [
        {
          rootPath: 'customer',
          relationshipFieldKey: 'customer',
          target: { entityKind: 'contact' },
          fields: [{ sourcePath: 'email', target: 'email' }],
        },
      ],
    }
    vi.mocked(getCachedEntityDefId).mockResolvedValue('def_contact')
    vi.mocked(getCachedCustomFields).mockResolvedValue([
      { id: 'f_email', name: 'Email', systemAttribute: 'email', type: 'EMAIL' },
    ] as never)

    await materializeAppContributingMappings(db, ORG, STREAM_ID, orderStream, APP, {
      '': { mappingId: 'm_owned_root', apiSlug: 'shopify_orders' },
    })

    expect(inserted).toHaveLength(1)
    // Owned parent wins; the bare key keeps the connection-late-bound @app: envelope
    // (namespaced with the owned parent's apiSlug, resolved via seedAppOwnedMappings).
    expect(inserted[0]).toMatchObject({
      rootPath: 'customer',
      parentMappingId: 'm_owned_root',
    })
    expect(inserted[0]?.relationshipFieldKey).toBe('shopify_orders:@app:shopify:customer')
  })
})

describe('resolveContributingRelationshipFieldKey', () => {
  it('wraps a bare key in the @app: envelope (unchanged path)', async () => {
    await expect(
      resolveContributingRelationshipFieldKey(ORG, 'product', APP, 'shopify_line_items', null)
    ).resolves.toBe('shopify_line_items:@app:shopify:product')
  })

  it('resolves system:<attr> against the parent def to the concrete editor-form ref', async () => {
    await expect(
      resolveContributingRelationshipFieldKey(
        ORG,
        'system:part_vendor_parts',
        APP,
        'part',
        'def_part'
      )
    ).resolves.toBe(toResourceFieldId('def_part', 'f_vp'))
  })

  it('drops a system edge with no contributing parent def (warn, edge-less mapping)', async () => {
    await expect(
      resolveContributingRelationshipFieldKey(ORG, 'system:part_vendor_parts', APP, 'part', null)
    ).resolves.toBeNull()
  })

  it('drops a system edge whose attribute does not exist on the parent def', async () => {
    await expect(
      resolveContributingRelationshipFieldKey(ORG, 'system:nope', APP, 'part', 'def_part')
    ).resolves.toBeNull()
  })

  it('passes null/undefined through', async () => {
    await expect(
      resolveContributingRelationshipFieldKey(ORG, null, APP, 'x', null)
    ).resolves.toBeNull()
  })
})
