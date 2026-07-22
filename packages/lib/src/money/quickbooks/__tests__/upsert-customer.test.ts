// packages/lib/src/money/quickbooks/__tests__/upsert-customer.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const readQuickbooksIdField = vi.fn()
const writeQuickbooksIdField = vi.fn()
vi.mock('../identity-field', () => ({
  readQuickbooksIdField: (...a: unknown[]) => readQuickbooksIdField(...a),
  writeQuickbooksIdField: (...a: unknown[]) => writeQuickbooksIdField(...a),
}))

import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { upsertQuickbooksCustomer } from '../upsert-customer'

const ORG_ID = 'org1'
const CONTACT_ID = 'contact1'
const handler = {} as never // opaque — only threaded through to the mocked identity-field reads

function buildCtx(callTool = vi.fn()): QuickbooksToolContext {
  return {
    organizationId: ORG_ID,
    installationId: 'install1',
    connectionId: 'conn1',
    userId: 'user1',
    callTool,
  }
}

beforeEach(() => {
  readQuickbooksIdField.mockReset()
  writeQuickbooksIdField.mockReset()
})

describe('upsertQuickbooksCustomer', () => {
  it('returns the stored id without calling any QuickBooks tool (idempotent fast path)', async () => {
    readQuickbooksIdField.mockResolvedValue('qbo-cust-existing')
    const callTool = vi.fn()

    const result = await upsertQuickbooksCustomer(buildCtx(callTool), {
      organizationId: ORG_ID,
      contactInstanceId: CONTACT_ID,
      contactFields: { firstName: 'Jane', lastName: 'Doe', primaryEmail: 'jane@example.com' },
      handler,
    })

    expect(result).toBe('qbo-cust-existing')
    expect(callTool).not.toHaveBeenCalled()
    expect(writeQuickbooksIdField).not.toHaveBeenCalled()
  })

  it('finds by exact email and writes the id back — no create call', async () => {
    readQuickbooksIdField.mockResolvedValue(undefined)
    const callTool = vi.fn().mockResolvedValue({ found: true, customer: { customerId: '99' } })

    const result = await upsertQuickbooksCustomer(buildCtx(callTool), {
      organizationId: ORG_ID,
      contactInstanceId: CONTACT_ID,
      contactFields: { firstName: 'Jane', lastName: 'Doe', primaryEmail: 'jane@example.com' },
      handler,
    })

    expect(result).toBe('99')
    expect(callTool).toHaveBeenCalledWith('find_quickbooks_customer', { email: 'jane@example.com' })
    expect(callTool).not.toHaveBeenCalledWith('create_quickbooks_customer', expect.anything())
    expect(writeQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({
        appFieldKey: 'qboCustomerId',
        entityType: 'contact',
        entityInstanceId: CONTACT_ID,
        externalId: '99',
      })
    )
  })

  it('creates a customer when the email search misses', async () => {
    readQuickbooksIdField.mockResolvedValue(undefined)
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ found: false, customer: null, notImportedReason: null })
      .mockResolvedValueOnce({ customerId: '101', displayName: 'Jane Doe' })

    const result = await upsertQuickbooksCustomer(buildCtx(callTool), {
      organizationId: ORG_ID,
      contactInstanceId: CONTACT_ID,
      contactFields: { firstName: 'Jane', lastName: 'Doe', primaryEmail: 'jane@example.com' },
      handler,
    })

    expect(result).toBe('101')
    expect(callTool).toHaveBeenNthCalledWith(
      2,
      'create_quickbooks_customer',
      expect.objectContaining({
        displayName: 'Jane Doe',
        givenName: 'Jane',
        familyName: 'Doe',
        email: 'jane@example.com',
      })
    )
  })

  it('skips the email search and creates directly when the contact has no email', async () => {
    readQuickbooksIdField.mockResolvedValue(undefined)
    const callTool = vi.fn().mockResolvedValue({ customerId: '202', displayName: 'Jane Doe' })

    const result = await upsertQuickbooksCustomer(buildCtx(callTool), {
      organizationId: ORG_ID,
      contactInstanceId: CONTACT_ID,
      contactFields: { firstName: 'Jane', lastName: 'Doe' },
      handler,
    })

    expect(result).toBe('202')
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledWith(
      'create_quickbooks_customer',
      expect.objectContaining({ displayName: 'Jane Doe' })
    )
  })

  it('throws when the contact has neither a name nor an email to create with', async () => {
    readQuickbooksIdField.mockResolvedValue(undefined)
    const callTool = vi.fn()

    await expect(
      upsertQuickbooksCustomer(buildCtx(callTool), {
        organizationId: ORG_ID,
        contactInstanceId: CONTACT_ID,
        contactFields: {},
        handler,
      })
    ).rejects.toThrow(/no name or email/)
    expect(callTool).not.toHaveBeenCalled()
  })
})
