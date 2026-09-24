// packages/lib/src/data-migrations/migrations/__tests__/191-product-status-unlisted.test.ts

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

const { migration191ProductStatusUnlisted, withUnlistedOption } = await import(
  '../191-product-status-unlisted'
)
const { ALL_DATA_MIGRATIONS } = await import('../../registry')
const { ProductStatus } = await import('../../../resources/registry/enum-values')
const { PRODUCT_FIELDS } = await import('../../../resources/registry/resources/product-fields')

const SEEDED = [
  { value: 'draft', label: 'Draft', color: 'gray' },
  { value: 'active', label: 'Active', color: 'green' },
  { value: 'archived', label: 'Archived', color: 'amber' },
]

/** One stored `product_status` field; `null` for an org without the product def. */
let stored: { id: string; options: { options: typeof SEEDED; isCustom: boolean } } | null
let updates = 0

function fakeDb(): Database {
  return {
    query: { CustomField: { findFirst: async () => stored } },
    update: (table: unknown) => ({
      set: (values: { options: unknown }) => ({
        where: async () => {
          expect(table).toBe(schema.CustomField)
          updates++
          if (stored) stored = { ...stored, options: values.options as never }
        },
      }),
    }),
  } as unknown as Database
}

beforeEach(() => {
  stored = { id: 'f_status', options: { options: [...SEEDED], isCustom: false } }
  updates = 0
  invalidateAndRecompute.mockClear()
})

describe('the registry', () => {
  it('carries unlisted between active and archived, on the product status field', () => {
    expect(ProductStatus.UNLISTED).toBe('unlisted')
    expect(ProductStatus.values.map((o) => o.value)).toEqual([
      'draft',
      'active',
      'unlisted',
      'archived',
    ])
    expect(PRODUCT_FIELDS.status?.options?.options).toBe(ProductStatus.values)
  })

  it('writes the same option the registry seeds fresh orgs with', () => {
    const next = withUnlistedOption(SEEDED)
    expect(next).toEqual(ProductStatus.values)
  })

  it('is registered once', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id.startsWith('191-'))).toEqual(['191-product-status-unlisted'])
  })
})

describe('withUnlistedOption', () => {
  it('keeps every stored option, including an org-added one', () => {
    const custom = { value: 'preorder', label: 'Pre-order', color: 'teal' }
    expect(withUnlistedOption([...SEEDED, custom])?.map((o) => o.value)).toEqual([
      'draft',
      'active',
      'unlisted',
      'archived',
      'preorder',
    ])
  })

  it('appends when active is missing', () => {
    expect(withUnlistedOption([SEEDED[0]!])?.map((o) => o.value)).toEqual(['draft', 'unlisted'])
  })

  it('is a no-op once present, whatever the org relabelled it to', () => {
    expect(withUnlistedOption([...SEEDED, { value: 'unlisted', label: 'Hidden' }])).toBeNull()
  })
})

describe('migration 191 up()', () => {
  const runUp = () => migration191ProductStatusUnlisted.up(fakeDb(), 'org_1')

  it('adds the option once, then reports up to date', async () => {
    expect((await runUp()).alreadyUpToDate).toBe(false)
    expect(stored?.options.options.map((o) => o.value)).toContain('unlisted')
    expect(stored?.options.isCustom).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledTimes(1)

    expect((await runUp()).alreadyUpToDate).toBe(true)
    expect(updates).toBe(1)
  })

  it('skips an org without the product status field', async () => {
    stored = null
    expect((await runUp()).alreadyUpToDate).toBe(true)
    expect(updates).toBe(0)
  })
})
