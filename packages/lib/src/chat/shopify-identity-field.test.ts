// packages/lib/src/chat/shopify-identity-field.test.ts
// The chat passport writer converges with the connector on the same
// connection-scoped customerId cell, then mirrors it into RecordIdentity.
// plans/data-connectors/v7/option-3-multi-source-identity-store-plan.md Phase 2/4.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listCredentials = vi.fn()
vi.mock('@auxx/credentials/store', () => ({
  listCredentials: (...a: unknown[]) => listCredentials(...a),
}))

const getCachedEntityDefId = vi.fn()
vi.mock('../cache', () => ({
  getCachedEntityDefId: (...a: unknown[]) => getCachedEntityDefId(...a),
}))

const setValue = vi.fn()
vi.mock('../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValue = (...a: unknown[]) => setValue(...a)
  },
}))

const upsertRecordIdentity = vi.fn()
vi.mock('../identity', () => ({
  upsertRecordIdentity: (...a: unknown[]) => upsertRecordIdentity(...a),
}))

import { writeShopifyCustomerIdField } from './shopify-identity-field'

const ORG_ID = 'org1'
const INSTALLATION_ID = 'install1'
const CONNECTION_ID = 'conn1'
const CONTACT_DEF_ID = 'def_contact'
const FIELD_ID = 'field1'
const CONTACT_ID = 'contact1'
const SHOP_DOMAIN = 'us.myshopify.com'
const SHOPIFY_CUSTOMER_ID = '207119551'

function buildDb() {
  return {
    query: {
      App: { findFirst: vi.fn().mockResolvedValue({ id: 'app1' }) },
      AppInstallation: { findFirst: vi.fn().mockResolvedValue({ id: INSTALLATION_ID }) },
      CustomField: { findFirst: vi.fn().mockResolvedValue({ id: FIELD_ID }) },
    },
  }
}

beforeEach(() => {
  listCredentials.mockReset()
  listCredentials.mockResolvedValue({
    isErr: () => false,
    value: [{ id: CONNECTION_ID, metadata: { shopDomain: SHOP_DOMAIN } }],
  })
  getCachedEntityDefId.mockReset()
  getCachedEntityDefId.mockResolvedValue(CONTACT_DEF_ID)
  setValue.mockReset()
  setValue.mockResolvedValue(undefined)
  upsertRecordIdentity.mockReset()
  upsertRecordIdentity.mockResolvedValue({ ok: true, value: { id: 'ri1' } })
})

describe('writeShopifyCustomerIdField', () => {
  it('writes the FieldValue and mirrors it into RecordIdentity', async () => {
    const db = buildDb()

    const result = await writeShopifyCustomerIdField({
      organizationId: ORG_ID,
      contactId: CONTACT_ID,
      shopDomain: SHOP_DOMAIN,
      shopifyCustomerId: SHOPIFY_CUSTOMER_ID,
      db: db as never,
    })

    expect(result).toBe(true)
    expect(setValue).toHaveBeenCalledWith(
      expect.objectContaining({ fieldId: FIELD_ID, value: SHOPIFY_CUSTOMER_ID })
    )
    expect(upsertRecordIdentity).toHaveBeenCalledTimes(1)
    expect(upsertRecordIdentity.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG_ID,
      entityInstanceId: CONTACT_ID,
      entityDefinitionId: CONTACT_DEF_ID,
      source: 'shopify',
      appInstallationId: INSTALLATION_ID,
      connectionId: CONNECTION_ID,
      appFieldKey: 'customerId',
      fieldId: FIELD_ID,
      externalId: SHOPIFY_CUSTOMER_ID,
    })
  })

  it('still returns true when the mirror write fails (best-effort, never fails the passport)', async () => {
    const db = buildDb()
    upsertRecordIdentity.mockResolvedValue({ ok: false, error: new Error('conflict') })

    const result = await writeShopifyCustomerIdField({
      organizationId: ORG_ID,
      contactId: CONTACT_ID,
      shopDomain: SHOP_DOMAIN,
      shopifyCustomerId: SHOPIFY_CUSTOMER_ID,
      db: db as never,
    })

    expect(result).toBe(true)
    expect(setValue).toHaveBeenCalledTimes(1)
  })

  it('skips the mirror (but still writes the cell + returns true) when contact has no entity definition', async () => {
    const db = buildDb()
    getCachedEntityDefId.mockResolvedValue(null)

    const result = await writeShopifyCustomerIdField({
      organizationId: ORG_ID,
      contactId: CONTACT_ID,
      shopDomain: SHOP_DOMAIN,
      shopifyCustomerId: SHOPIFY_CUSTOMER_ID,
      db: db as never,
    })

    expect(result).toBe(true)
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(upsertRecordIdentity).not.toHaveBeenCalled()
  })

  it('returns false without writing or mirroring when no bound connection matches the shop domain', async () => {
    const db = buildDb()
    listCredentials.mockResolvedValue({ isErr: () => false, value: [] })

    const result = await writeShopifyCustomerIdField({
      organizationId: ORG_ID,
      contactId: CONTACT_ID,
      shopDomain: SHOP_DOMAIN,
      shopifyCustomerId: SHOPIFY_CUSTOMER_ID,
      db: db as never,
    })

    expect(result).toBe(false)
    expect(setValue).not.toHaveBeenCalled()
    expect(upsertRecordIdentity).not.toHaveBeenCalled()
  })
})
