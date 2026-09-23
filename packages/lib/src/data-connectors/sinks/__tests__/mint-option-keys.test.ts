// packages/lib/src/data-connectors/sinks/__tests__/mint-option-keys.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../custom-fields/mint-options', () => ({
  mintOrMatchOptions: vi.fn(),
}))

const { mintOrMatchOptions } = await import('../../../custom-fields/mint-options')
const { mintOptionKeys } = await import('../mint-option-keys')

const minter = vi.mocked(mintOrMatchOptions)
const db = {} as never
const ORG = 'org_1'

/** A system TAGS field with an open taxonomy, like `order_payment_gateways`. */
const tagsField = {
  id: 'field_tags',
  type: 'TAGS',
  systemAttribute: 'order_payment_gateways',
  options: { options: [{ value: 'opt_shopify', label: 'shopify_payments' }] },
}

/** Mirror the minter's dry-run contract: known labels resolve, unknown echo back. */
function dryRunOf(known: Record<string, string>) {
  return (_db: unknown, params: { labels: unknown[]; dryRun?: boolean }) => {
    const labels = params.labels as string[]
    const ids = labels.map((l) => known[l] ?? l)
    const mintedLabels = labels.filter((l) => !known[l])
    return Promise.resolve({ ids, minted: mintedLabels.length, mintedLabels })
  }
}

describe('mintOptionKeys', () => {
  beforeEach(() => {
    minter.mockReset()
  })

  it('resolves a known label from the cached options without taking the row lock', async () => {
    minter.mockImplementation(dryRunOf({ shopify_payments: 'opt_shopify' }))

    await expect(mintOptionKeys(db, ORG, tagsField, ['shopify_payments'])).resolves.toEqual([
      'opt_shopify',
    ])
    expect(minter).toHaveBeenCalledTimes(1)
    expect(minter.mock.calls[0]![1]).toMatchObject({ dryRun: true, fieldId: 'field_tags' })
  })

  it('mints an unknown label and writes the minted key instead of the raw text', async () => {
    minter
      .mockImplementationOnce(dryRunOf({ shopify_payments: 'opt_shopify' }))
      .mockResolvedValueOnce({
        ids: ['opt_shopify', 'opt_affirm'],
        minted: 1,
        mintedLabels: ['Affirm'],
      })

    await expect(
      mintOptionKeys(db, ORG, tagsField, ['shopify_payments', 'Affirm'])
    ).resolves.toEqual(['opt_shopify', 'opt_affirm'])
    expect(minter).toHaveBeenCalledTimes(2)
    expect(minter.mock.calls[1]![1]).toEqual({
      fieldId: 'field_tags',
      organizationId: ORG,
      labels: ['shopify_payments', 'Affirm'],
    })
  })

  it('keeps a scalar shape for a single tag on the row-level multi path', async () => {
    minter.mockImplementation(dryRunOf({ shopify_payments: 'opt_shopify' }))

    await expect(mintOptionKeys(db, ORG, tagsField, 'shopify_payments')).resolves.toBe(
      'opt_shopify'
    )
  })

  it('leaves a field that may not grow untouched', async () => {
    const connectorOwned = { ...tagsField, dataConnectorId: 'dc_1' }
    const systemSelect = { id: 'f', type: 'SINGLE_SELECT', systemAttribute: 'ticket_status' }
    const closed = { ...tagsField, options: { allowNewOptions: false, options: [] } }

    await expect(mintOptionKeys(db, ORG, connectorOwned, ['x'])).resolves.toEqual(['x'])
    await expect(mintOptionKeys(db, ORG, systemSelect, 'open')).resolves.toBe('open')
    await expect(mintOptionKeys(db, ORG, closed, ['x'])).resolves.toEqual(['x'])
    expect(minter).not.toHaveBeenCalled()
  })

  it('passes non-option types, blanks and unresolved fields through', async () => {
    await expect(mintOptionKeys(db, ORG, { id: 'f', type: 'TEXT' }, 'a,b')).resolves.toBe('a,b')
    await expect(mintOptionKeys(db, ORG, tagsField, [])).resolves.toEqual([])
    await expect(mintOptionKeys(db, ORG, tagsField, '')).resolves.toBe('')
    await expect(mintOptionKeys(db, ORG, tagsField, null)).resolves.toBeNull()
    await expect(mintOptionKeys(db, ORG, undefined, ['x'])).resolves.toEqual(['x'])
    expect(minter).not.toHaveBeenCalled()
  })
})
