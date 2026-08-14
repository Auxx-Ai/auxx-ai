// packages/lib/src/ingest/contacts/__tests__/find-or-create-from-jwt.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- mocks -----------------------------------------------------------------

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from this
// barrel at module load, so a full replacement breaks whichever test file happens
// to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

vi.mock('@auxx/types/resource', () => ({
  toRecordId: (defId: string, instId: string) => `${defId}:${instId}`,
  getInstanceId: (recordId: string) => recordId.slice(recordId.indexOf(':') + 1),
}))

const getCachedEntityDefId = vi.fn()
vi.mock('../../../cache', () => ({
  getCachedEntityDefId: (...args: unknown[]) => getCachedEntityDefId(...args),
}))

const resolveShopifyStoreConnection = vi.fn()
vi.mock('../../../chat/shopify-identity-field', () => ({
  resolveShopifyStoreConnection: (...args: unknown[]) => resolveShopifyStoreConnection(...args),
}))

const findRecordByIdentity = vi.fn()
const upsertRecordIdentity = vi.fn()
vi.mock('../../../identity', () => ({
  findRecordByIdentity: (...args: unknown[]) => findRecordByIdentity(...args),
  upsertRecordIdentity: (...args: unknown[]) => upsertRecordIdentity(...args),
}))

const findByField = vi.fn()
const update = vi.fn()
const create = vi.fn()
vi.mock('../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    findByField = findByField
    update = update
    create = create
  },
}))

vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: vi.fn().mockResolvedValue('system_user') },
}))

import { findOrCreateContactFromJwt } from '../find-or-create-from-jwt'

const CONTACT_DEF = 'def_contact'

beforeEach(() => {
  vi.clearAllMocks()
  getCachedEntityDefId.mockResolvedValue(CONTACT_DEF)
  upsertRecordIdentity.mockResolvedValue({ ok: true, value: {} })
  findByField.mockResolvedValue(null)
  update.mockResolvedValue(undefined)
  create.mockResolvedValue({ instance: { id: 'new_contact' } })
  findRecordByIdentity.mockResolvedValue(null)
})

describe('findOrCreateContactFromJwt — chat (app-less) visitor', () => {
  it('resolves an existing contact by the app-less chat link (tier-1, no email required)', async () => {
    findRecordByIdentity.mockResolvedValueOnce({
      recordId: `${CONTACT_DEF}:contact_1`,
      displayName: 'Jane',
    })

    const result = await findOrCreateContactFromJwt({
      organizationId: 'org_1',
      userId: 'visitor_abc',
    })

    expect(findRecordByIdentity).toHaveBeenCalledWith({
      organizationId: 'org_1',
      entityDefinitionId: CONTACT_DEF,
      source: 'chat',
      externalId: 'visitor_abc',
      connectionId: null,
      appFieldKey: null,
    })
    expect(result).toEqual({ contactId: 'contact_1', resolution: 'matched_external_id' })
    // Never touches the retired external_id array.
    expect(update).not.toHaveBeenCalled()
    // Re-asserts the chat link (idempotent).
    expect(upsertRecordIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'chat', externalId: 'visitor_abc', fieldId: null })
    )
  })

  it('creates a contact and mirrors the chat link when nothing matches', async () => {
    const result = await findOrCreateContactFromJwt({
      organizationId: 'org_1',
      userId: 'visitor_new',
      email: 'jane@example.com',
    })

    expect(create).toHaveBeenCalledWith('contact', {
      primary_email: 'jane@example.com',
      contact_status: 'ACTIVE',
    })
    // No external_id array in the create payload.
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty('external_id')
    expect(upsertRecordIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityInstanceId: 'new_contact',
        source: 'chat',
        externalId: 'visitor_new',
        connectionId: null,
        appFieldKey: null,
        fieldId: null,
      })
    )
    expect(result).toEqual({ contactId: 'new_contact', resolution: 'created' })
  })

  it('never lets a caller attribute override the signed JWT email on create', async () => {
    const result = await findOrCreateContactFromJwt({
      organizationId: 'org_1',
      userId: 'visitor_new',
      email: 'jane@example.com',
      // Defense in depth: `primary_email` is already stripped upstream by
      // resolveChatAttributes, but even a raw bag must not win over the JWT.
      attributes: { primary_email: 'attacker@evil.com', first_name: 'Jane' },
    })

    expect(create).toHaveBeenCalledWith('contact', {
      contact_status: 'ACTIVE',
      first_name: 'Jane',
      primary_email: 'jane@example.com',
    })
    expect(result.resolution).toBe('created')
  })

  it('email-folds onto an existing contact and mirrors the chat link (no duplicate)', async () => {
    findByField.mockResolvedValueOnce({ id: 'existing_contact' })

    const result = await findOrCreateContactFromJwt({
      organizationId: 'org_1',
      userId: 'visitor_2',
      email: 'jane@example.com',
      attributes: { first_name: 'Jane' },
    })

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('contact:existing_contact', { first_name: 'Jane' })
    expect(upsertRecordIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ entityInstanceId: 'existing_contact', source: 'chat' })
    )
    expect(result).toEqual({ contactId: 'existing_contact', resolution: 'matched_email' })
  })
})

describe('findOrCreateContactFromJwt — Shopify storefront visitor', () => {
  const shopify = { shopDomain: 'us.myshopify.com', customerId: '207119551' }

  it('resolves a connector-synced contact by connection-scoped customerId (converges, no email)', async () => {
    resolveShopifyStoreConnection.mockResolvedValueOnce({
      appId: 'app_shopify',
      installationId: 'inst_1',
      connectionId: 'conn_us',
    })
    findRecordByIdentity.mockResolvedValueOnce({
      recordId: `${CONTACT_DEF}:synced_contact`,
      displayName: 'Jane',
    })

    const result = await findOrCreateContactFromJwt({
      organizationId: 'org_1',
      userId: 'shopify:us.myshopify.com:207119551',
      shopify,
    })

    expect(resolveShopifyStoreConnection).toHaveBeenCalledWith('org_1', 'us.myshopify.com')
    expect(findRecordByIdentity).toHaveBeenCalledWith({
      organizationId: 'org_1',
      entityDefinitionId: CONTACT_DEF,
      source: 'shopify',
      connectionId: 'conn_us',
      appFieldKey: 'customerId',
      externalId: '207119551',
    })
    expect(result).toEqual({ contactId: 'synced_contact', resolution: 'matched_external_id' })
    // Shopify identity is mirrored by writeShopifyCustomerIdField, NOT here.
    expect(upsertRecordIdentity).not.toHaveBeenCalled()
  })

  it('keeps the same customer id under two stores separate via connection scoping', async () => {
    resolveShopifyStoreConnection.mockResolvedValueOnce({
      appId: 'app_shopify',
      installationId: 'inst_1',
      connectionId: 'conn_eu',
    })
    // EU store connection has no row for this id → miss, falls through to create.
    findRecordByIdentity.mockResolvedValueOnce(null)

    const result = await findOrCreateContactFromJwt({
      organizationId: 'org_1',
      userId: 'shopify:eu.myshopify.com:207119551',
      shopify: { shopDomain: 'eu.myshopify.com', customerId: '207119551' },
    })

    expect(findRecordByIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn_eu', externalId: '207119551' })
    )
    expect(create).toHaveBeenCalled()
    // No chat link mirrored for a Shopify visitor.
    expect(upsertRecordIdentity).not.toHaveBeenCalled()
    expect(result.resolution).toBe('created')
  })

  it('falls through to email-fold when the store connection cannot be resolved', async () => {
    resolveShopifyStoreConnection.mockResolvedValueOnce(null)
    findByField.mockResolvedValueOnce({ id: 'by_email' })

    const result = await findOrCreateContactFromJwt({
      organizationId: 'org_1',
      userId: 'shopify:us.myshopify.com:207119551',
      email: 'jane@example.com',
      shopify,
    })

    expect(findRecordByIdentity).not.toHaveBeenCalled()
    expect(result).toEqual({ contactId: 'by_email', resolution: 'matched_email' })
    // Shopify visitor → no chat link even on email-fold.
    expect(upsertRecordIdentity).not.toHaveBeenCalled()
  })
})
