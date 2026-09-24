// packages/lib/src/data-migrations/migrations/__tests__/190-parts-and-services.test.ts

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Migration190Result } from '../190-parts-and-services'

const ORG = 'org_1'
const PART_DEF = 'def_part'

/** The org as the fakes see it; each run mutates it, so a second run sees the migrated state. */
interface World {
  partDef: { id: string; singular: string; plural: string } | null
  kindOptions: { value: string; label: string }[]
  fieldKeys: Set<string>
  partners: string[]
  catalogDefId: string | null
  entries: string[]
}
let world: World

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

const deleteEntityDefinitionDeep = vi.fn(async () => {
  world.catalogDefId = null
  return {}
})
vi.mock('../../../entity-definitions/delete-entity-definition', () => ({
  deleteEntityDefinitionDeep,
}))

const ensureCustomFields = vi.fn(
  async (
    _db: unknown,
    _org: string,
    _type: string,
    _defId: string,
    fields: Record<string, unknown>,
    _existing: unknown,
    state: { fieldsCreated: number }
  ) => {
    for (const key of Object.keys(fields)) {
      if (world.fieldKeys.has(key)) continue
      world.fieldKeys.add(key)
      state.fieldsCreated++
    }
  }
)
vi.mock('../../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureCustomFields,
  loadExistingState: async () => ({
    entityDefs: new Map(
      world.partDef ? [['part', { id: world.partDef.id, entityType: 'part' }]] : []
    ),
    fields: new Map([
      [
        `${PART_DEF}:part_kind`,
        {
          id: 'f_kind',
          systemAttribute: 'part_kind',
          entityDefinitionId: PART_DEF,
          options: { options: world.kindOptions },
        },
      ],
    ]),
  }),
}))

const { migration190PartsAndServices, partLabelPatch, withServiceOption } = await import(
  '../190-parts-and-services'
)
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { SYSTEM_ENTITIES } = await import('../../../seed/entity-seeder/constants')
const { RESOURCE_FIELD_REGISTRY } = await import('../../../resources/registry/field-registry')
const { LINE_ITEM_FIELDS } = await import('../../../resources/registry/resources/line-item-fields')
const { PART_FIELDS } = await import('../../../resources/registry/resources/part-fields')

/** A Drizzle stand-in answering the selects, updates and deletes the migration issues. */
function fakeDb(): Database {
  const deletes: (() => string[])[] = [
    () => world.partners.splice(0),
    () => world.entries.splice(0),
  ]
  const db = {
    select: (columns: Record<string, unknown>) => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => {
          if ('singular' in columns) return world.partDef ? [world.partDef] : []
          return world.catalogDefId ? [{ id: world.catalogDefId }] : []
        },
      }
      return chain
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === schema.EntityDefinition && world.partDef) {
            world.partDef = { ...world.partDef, ...values } as World['partDef']
          }
          if (table === schema.CustomField) {
            world.kindOptions = (values.options as { options: World['kindOptions'] }).options
          }
        },
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => (deletes.shift()?.() ?? []).map((id) => ({ id })),
      }),
    }),
  }
  return db as unknown as Database
}

const runUp = () =>
  migration190PartsAndServices.up(fakeDb(), ORG) as unknown as Promise<Migration190Result>

beforeEach(() => {
  world = {
    partDef: { id: PART_DEF, singular: 'Part', plural: 'Parts' },
    kindOptions: [
      { value: 'component', label: 'Component' },
      { value: 'finished_good', label: 'Finished Good' },
    ],
    fieldKeys: new Set(),
    partners: ['f_line', 'f_part'],
    catalogDefId: 'def_catalog',
    entries: ['fv_1'],
  }
  invalidateAndRecompute.mockClear()
  deleteEntityDefinitionDeep.mockClear()
  ensureCustomFields.mockClear()
})

describe('migration 190 registration', () => {
  it('is registered once, and 191–193 are gone', () => {
    expect(PER_ORG_MIGRATIONS.filter((m) => m.id === '190-parts-and-services')).toHaveLength(1)
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    for (const gone of [
      '191-part-selling-fields',
      '192-remove-catalog-item',
      '193-part-channel-cost',
    ]) {
      expect(ids).not.toContain(gone)
    }
  })
})

describe('(a) part kind `service` and labels', () => {
  const stored = [
    { value: 'component', label: 'Component', color: 'gray' },
    { value: 'finished_good', label: 'Finished Good', color: 'green' },
  ]

  it('appends the service option, keeping every stored option as it was', () => {
    expect(withServiceOption(stored)).toEqual([
      ...stored,
      { value: 'service', label: 'Service', color: 'purple' },
    ])
  })

  it('is a no-op once the option is there', () => {
    expect(withServiceOption([...stored, { value: 'service', label: 'Svc' }])).toBeNull()
  })

  it('relabels the seeded defaults', () => {
    expect(partLabelPatch({ singular: 'Part', plural: 'Parts' })).toEqual({
      singular: 'Item',
      plural: 'Parts & Services',
    })
  })

  it('is a no-op once relabelled, and keeps a label an org chose itself', () => {
    expect(partLabelPatch({ singular: 'Item', plural: 'Parts & Services' })).toBeNull()
    expect(partLabelPatch({ singular: 'SKU', plural: 'Parts' })).toEqual({
      plural: 'Parts & Services',
    })
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

describe('migration 190 up()', () => {
  it('runs all four steps in order', async () => {
    const result = await runUp()

    expect(world.partDef).toMatchObject({ singular: 'Item', plural: 'Parts & Services' })
    expect(world.kindOptions.map((o) => o.value)).toEqual(['component', 'finished_good', 'service'])

    expect(ensureCustomFields.mock.calls.map((call) => Object.keys(call[4]))).toEqual([
      ['sellable', 'sellPrice', 'markup', 'taxable'],
      ['channelCost', 'standardCostOrigin'],
    ])
    expect(ensureCustomFields.mock.calls[0]?.[3]).toBe(PART_DEF)

    expect(deleteEntityDefinitionDeep).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'def_catalog', organizationId: ORG, allowSystemEntity: true })
    )

    expect(result).toMatchObject({
      labelsRenamed: true,
      serviceOptionAdded: true,
      fieldsCreated: 6,
      partnerFieldsRemoved: 2,
      catalogItemDefDeleted: true,
      groupEntriesCleared: 1,
      alreadyUpToDate: false,
    })
    expect(invalidateAndRecompute).toHaveBeenCalledTimes(1)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, [
      'customFields',
      'resources',
      'entityDefs',
      'entityDefSlugs',
    ])
  })

  it('is a no-op on a second run', async () => {
    await runUp()
    invalidateAndRecompute.mockClear()
    deleteEntityDefinitionDeep.mockClear()

    const result = await runUp()

    expect(result).toMatchObject({
      labelsRenamed: false,
      serviceOptionAdded: false,
      fieldsCreated: 0,
      partnerFieldsRemoved: 0,
      catalogItemDefDeleted: false,
      groupEntriesCleared: 0,
      alreadyUpToDate: true,
    })
    expect(deleteEntityDefinitionDeep).not.toHaveBeenCalled()
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('still removes catalog_item on an org without a part def', async () => {
    world.partDef = null
    const result = await runUp()

    expect(ensureCustomFields).not.toHaveBeenCalled()
    expect(result).toMatchObject({ labelsRenamed: false, catalogItemDefDeleted: true })
  })
})
