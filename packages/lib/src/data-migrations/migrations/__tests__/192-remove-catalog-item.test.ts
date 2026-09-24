// packages/lib/src/data-migrations/migrations/__tests__/192-remove-catalog-item.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Migration192Result } from '../192-remove-catalog-item'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

const deleteEntityDefinitionDeep = vi.fn(async () => ({}))
vi.mock('../../../entity-definitions/delete-entity-definition', () => ({
  deleteEntityDefinitionDeep,
}))

const { migration192RemoveCatalogItem } = await import('../192-remove-catalog-item')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { SYSTEM_ENTITIES } = await import('../../../seed/entity-seeder/constants')
const { RESOURCE_FIELD_REGISTRY } = await import('../../../resources/registry/field-registry')
const { LINE_ITEM_FIELDS } = await import('../../../resources/registry/resources/line-item-fields')
const { PART_FIELDS } = await import('../../../resources/registry/resources/part-fields')

const MIGRATION_ID = '192-remove-catalog-item'
const ORG = 'org_1'

const runUp = (db: Database) =>
  migration192RemoveCatalogItem.up(db, ORG) as unknown as Promise<Migration192Result>

/** Answers the two deletes (partner fields, then group entries) and the def lookup, in call order. */
function fakeDb(script: { partners: string[]; defId: string | null; entries: string[] }) {
  const deletes = [script.partners, script.entries]
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => (script.defId ? [{ id: script.defId }] : []),
  }
  const db = {
    delete: () => ({
      where: () => ({
        returning: async () => (deletes.shift() ?? []).map((id) => ({ id })),
      }),
    }),
    select: () => chain,
  }
  return db as unknown as Database
}

beforeEach(() => {
  invalidateAndRecompute.mockClear()
  deleteEntityDefinitionDeep.mockClear()
})

describe('migration 192 registration', () => {
  it('is registered once, sorted after 191', () => {
    expect(PER_ORG_MIGRATIONS.filter((m) => m.id === MIGRATION_ID)).toHaveLength(1)
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('191-part-selling-fields'))
  })
})

describe('catalog_item is gone from the registries', () => {
  it('is neither seeded nor registered', () => {
    expect(SYSTEM_ENTITIES.map((e) => e.entityType)).not.toContain('catalog_item')
    expect(Object.keys(RESOURCE_FIELD_REGISTRY)).not.toContain('catalog_item')
  })

  it('line_item and part no longer declare the relationship sides', () => {
    expect(Object.keys(LINE_ITEM_FIELDS)).not.toContain('catalogItem')
    expect(Object.keys(PART_FIELDS)).not.toContain('catalogItems')
  })
})

describe('migration 192 up()', () => {
  it('removes the partner fields, the def and stale group entries', async () => {
    const result = await runUp(
      fakeDb({ partners: ['f_line', 'f_part'], defId: 'def_catalog', entries: ['fv_1'] })
    )

    expect(result).toMatchObject({
      partnerFieldsRemoved: 2,
      catalogItemDefDeleted: true,
      groupEntriesCleared: 1,
      alreadyUpToDate: false,
    })
    expect(deleteEntityDefinitionDeep).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'def_catalog',
        organizationId: ORG,
        allowSystemEntity: true,
      })
    )
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, [
      'customFields',
      'resources',
      'entityDefs',
      'entityDefSlugs',
    ])
  })

  it('is a no-op on a second run', async () => {
    const result = await runUp(fakeDb({ partners: [], defId: null, entries: [] }))

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.catalogItemDefDeleted).toBe(false)
    expect(deleteEntityDefinitionDeep).not.toHaveBeenCalled()
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
