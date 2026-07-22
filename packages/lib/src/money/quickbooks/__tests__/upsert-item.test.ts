// packages/lib/src/money/quickbooks/__tests__/upsert-item.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const readQuickbooksIdField = vi.fn()
const writeQuickbooksIdField = vi.fn()
vi.mock('../identity-field', () => ({
  readQuickbooksIdField: (...a: unknown[]) => readQuickbooksIdField(...a),
  writeQuickbooksIdField: (...a: unknown[]) => writeQuickbooksIdField(...a),
}))

import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { upsertQuickbooksItem } from '../upsert-item'

const ORG_ID = 'org1'
const CATALOG_ITEM_ID = 'catalog1'
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

describe('upsertQuickbooksItem', () => {
  it('returns the stored id for a catalog-linked line without calling any QuickBooks tool', async () => {
    readQuickbooksIdField.mockResolvedValue('qbo-item-existing')
    const callTool = vi.fn()

    const result = await upsertQuickbooksItem(buildCtx(callTool), {
      organizationId: ORG_ID,
      itemName: 'Quarterly Service',
      catalogItemInstanceId: CATALOG_ITEM_ID,
      defaultIncomeAccountId: 'acct-1',
      handler,
    })

    expect(result).toBe('qbo-item-existing')
    expect(callTool).not.toHaveBeenCalled()
    expect(writeQuickbooksIdField).not.toHaveBeenCalled()
  })

  it('skips the stored-id check entirely for a line with no catalog item', async () => {
    const callTool = vi.fn().mockImplementation(async (toolId: string) => {
      if (toolId === 'list_quickbooks_items') return { items: [] }
      if (toolId === 'create_quickbooks_item') return { itemId: '55' }
      throw new Error(`unexpected: ${toolId}`)
    })

    const result = await upsertQuickbooksItem(buildCtx(callTool), {
      organizationId: ORG_ID,
      itemName: 'Ad-hoc Line',
      defaultIncomeAccountId: 'acct-1',
      handler,
    })

    expect(result).toBe('55')
    expect(readQuickbooksIdField).not.toHaveBeenCalled()
    expect(writeQuickbooksIdField).not.toHaveBeenCalled() // no catalogItemInstanceId to write onto
  })

  it('matches an existing QBO item by case-insensitive name — no create call', async () => {
    readQuickbooksIdField.mockResolvedValue(undefined)
    const callTool = vi.fn().mockImplementation(async (toolId: string) => {
      if (toolId === 'list_quickbooks_items') {
        return { items: [{ id: '61', name: 'quarterly service', type: 'Service' }] }
      }
      throw new Error(`unexpected: ${toolId}`)
    })

    const result = await upsertQuickbooksItem(buildCtx(callTool), {
      organizationId: ORG_ID,
      itemName: 'Quarterly Service',
      catalogItemInstanceId: CATALOG_ITEM_ID,
      defaultIncomeAccountId: 'acct-1',
      handler,
    })

    expect(result).toBe('61')
    expect(callTool).not.toHaveBeenCalledWith('create_quickbooks_item', expect.anything())
    expect(writeQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({
        appFieldKey: 'qboItemId',
        entityType: 'catalog_item',
        entityInstanceId: CATALOG_ITEM_ID,
        externalId: '61',
      })
    )
  })

  it('creates a new item against the default income account when no name match is found', async () => {
    readQuickbooksIdField.mockResolvedValue(undefined)
    const callTool = vi.fn().mockImplementation(async (toolId: string) => {
      if (toolId === 'list_quickbooks_items') return { items: [] }
      if (toolId === 'create_quickbooks_item') return { itemId: '77' }
      throw new Error(`unexpected: ${toolId}`)
    })

    const result = await upsertQuickbooksItem(buildCtx(callTool), {
      organizationId: ORG_ID,
      itemName: 'Brand New Service',
      catalogItemInstanceId: CATALOG_ITEM_ID,
      defaultIncomeAccountId: 'acct-1',
      handler,
    })

    expect(result).toBe('77')
    expect(callTool).toHaveBeenCalledWith('create_quickbooks_item', {
      name: 'Brand New Service',
      incomeAccountId: 'acct-1',
    })
  })

  it('throws a clear error when a create is needed but no default income account is configured', async () => {
    readQuickbooksIdField.mockResolvedValue(undefined)
    const callTool = vi.fn().mockImplementation(async (toolId: string) => {
      if (toolId === 'list_quickbooks_items') return { items: [] }
      throw new Error(`unexpected: ${toolId}`)
    })

    await expect(
      upsertQuickbooksItem(buildCtx(callTool), {
        organizationId: ORG_ID,
        itemName: 'Brand New Service',
        catalogItemInstanceId: CATALOG_ITEM_ID,
        defaultIncomeAccountId: null,
        handler,
      })
    ).rejects.toThrow(/default income account/)
    expect(callTool).not.toHaveBeenCalledWith('create_quickbooks_item', expect.anything())
  })
})
