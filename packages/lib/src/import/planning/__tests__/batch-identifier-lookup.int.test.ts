// packages/lib/src/import/planning/__tests__/batch-identifier-lookup.int.test.ts
//
// DB-backed tests (vitest.integration.config.ts) for the batched identifier
// pre-pass that replaces `analyzeRow`'s per-value query.
//
// Why integration and not unit: the default vitest config mocks
// `@auxx/database`, so every Drizzle column is `undefined` and no `IN (...)`
// predicate can be built at all — a fake-db test here would assert nothing. And
// the property under test is precisely that the batched answer and the per-row
// answer are the SAME answer: same case folding, same archived/org/definition
// scoping, same ambiguity. If they ever diverge, the batched path reports `none`
// for a value the per-row path matches, the row is classified `create`, and the
// import writes a duplicate with no error and no warning — the exact failure the
// update-strategy work exists to kill. Only real SQL can pin that.
//
// Every case asserts `batched === true` first. Without it the whole suite would
// pass vacuously against the per-row fallback the moment the pre-pass stopped
// engaging (a missing field map, a renamed column, an unreachable org cache).

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { generateId } from '@auxx/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Resource, ResourceField } from '../../../resources'
import { BaseType } from '../../../workflow-engine/core/types'
import { hashValue } from '../../hashing/hash-value'
import type { ImportMappingProperty } from '../../types/mapping'
import type { ValueResolution } from '../../types/resolution'
import {
  type BatchedIdentifierLookup,
  createBatchedFindExistingRecord,
} from '../batch-identifier-lookup'
import { createFindExistingRecord, type FindExistingRecord } from '../find-existing-record'

const SKU_COLUMN = 0

/** One mapped column carrying the identifier. */
const MAPPINGS: ImportMappingProperty[] = [
  {
    id: 'prop-sku',
    importMappingId: 'mapping-1',
    sourceColumnIndex: SKU_COLUMN,
    sourceColumnName: 'SKU',
    targetType: 'particle',
    targetFieldKey: 'part_sku',
    customFieldId: null,
    resolutionType: 'text:value',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ImportMappingProperty,
]

/** File rows, one identifier cell each. */
function rows(...cells: string[]): Map<number, Record<number, string>> {
  return new Map(cells.map((cell, index) => [index, { [SKU_COLUMN]: cell }]))
}

/** A valid split resolution: one cell that yields several identifier values. */
function splitResolution(rawValue: string, elements: string[]): [string, ValueResolution] {
  return [
    hashValue(rawValue),
    {
      id: `res-${rawValue}`,
      importJobPropertyId: 'prop-sku',
      hashedValue: hashValue(rawValue),
      rawValue,
      cellCount: 1,
      resolvedValues: [{ type: 'value', value: elements }],
      isValid: true,
    } as unknown as ValueResolution,
  ]
}

describe('createBatchedFindExistingRecord, FieldValue lane', () => {
  let db: ReturnType<typeof getTestDb>
  let organizationId: string
  let otherOrganizationId: string
  let partDefId: string
  let otherDefId: string
  let skuFieldId: string
  /** Counts every value the pre-pass could not answer from memory. */
  let fallbackCalls: number

  const seedDef = async (orgId: string, slug: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.EntityDefinition).values({
      id,
      organizationId: orgId,
      apiSlug: slug,
      singular: slug,
      plural: `${slug}s`,
      updatedAt: new Date(),
    } as typeof schema.EntityDefinition.$inferInsert)
    return id
  }

  const seedField = async (orgId: string, defId: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.CustomField).values({
      id,
      organizationId: orgId,
      entityDefinitionId: defId,
      name: 'SKU',
      type: 'TEXT',
      modelType: 'part',
      systemAttribute: null,
      updatedAt: new Date(),
    } as typeof schema.CustomField.$inferInsert)
    return id
  }

  /** One record carrying `sku`, in the given org/definition. */
  const seedRecord = async (
    sku: string,
    options?: {
      orgId?: string
      defId?: string
      fieldId?: string
      archived?: boolean
    }
  ): Promise<string> => {
    const orgId = options?.orgId ?? organizationId
    const defId = options?.defId ?? partDefId
    const instanceId = generateId()
    await db.insert(schema.EntityInstance).values({
      id: instanceId,
      organizationId: orgId,
      entityDefinitionId: defId,
      archivedAt: options?.archived ? new Date() : null,
      updatedAt: new Date(),
    } as typeof schema.EntityInstance.$inferInsert)
    await db.insert(schema.FieldValue).values({
      id: generateId(),
      organizationId: orgId,
      fieldId: options?.fieldId ?? skuFieldId,
      entityId: instanceId,
      entityDefinitionId: defId,
      valueText: sku,
      updatedAt: new Date(),
    } as typeof schema.FieldValue.$inferInsert)
    return instanceId
  }

  const resource = (): Resource =>
    ({ id: 'part', type: 'custom', entityDefinitionId: partDefId }) as unknown as Resource

  const skuField = (): ResourceField =>
    ({ id: skuFieldId, key: 'part_sku', type: BaseType.STRING }) as unknown as ResourceField

  /**
   * Build the batched resolver over `cells`, with a fallback that counts its
   * own use and then answers exactly the way production's per-row path does.
   */
  const build = async (
    cells: string[],
    resolutions: Map<string, ValueResolution> = new Map()
  ): Promise<BatchedIdentifierLookup> => {
    fallbackCalls = 0
    const identifierFields = [skuField()]
    const perRow = createFindExistingRecord({
      db: db as never,
      organizationId,
      resource: resource(),
      identifierFields,
    })
    const fallback: FindExistingRecord = async (values) => {
      fallbackCalls++
      return perRow(values)
    }
    return createBatchedFindExistingRecord({
      db: db as never,
      organizationId,
      resource: resource(),
      identifierFields,
      rawData: rows(...cells),
      mappings: MAPPINGS,
      resolutions,
      fallback,
    })
  }

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
    const other = await createTestOrganization()
    otherOrganizationId = other.id
    partDefId = await seedDef(organizationId, 'part')
    otherDefId = await seedDef(organizationId, 'contact')
    skuFieldId = await seedField(organizationId, partDefId)
  })

  it('resolves every row of the file in ONE query', async () => {
    const first = await seedRecord('M400L')
    const second = await seedRecord('M401L')

    // Fifty rows over two distinct values: the per-row path would issue fifty
    // serialized queries, this issues one.
    const cells = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 'M400L' : 'M401L'))
    const lookup = await build(cells)

    expect(lookup.batched).toBe(true)
    expect(lookup.queryCount).toBe(1)
    expect(lookup.indexedValues).toBe(2)

    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({
      kind: 'one',
      recordId: first,
    })
    await expect(lookup.find({ part_sku: 'M401L' })).resolves.toEqual({
      kind: 'one',
      recordId: second,
    })
    expect(fallbackCalls).toBe(0)
  })

  it('matches a LOWER-CASE cell against an UPPER-CASE stored value', async () => {
    const id = await seedRecord('M400L')
    const lookup = await build(['m400l'])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'm400l' })).resolves.toEqual({ kind: 'one', recordId: id })
    expect(fallbackCalls).toBe(0)
  })

  it('matches an UPPER-CASE cell against a LOWER-CASE stored value', async () => {
    const id = await seedRecord('m400l')
    const lookup = await build(['M400L'])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({ kind: 'one', recordId: id })
  })

  // `lower(col) IN (…)`, never ILIKE: `_` and `%` are ordinary in SKUs, and a
  // false match here UPDATES an unrelated record instead of creating a new one.
  it('does not treat `_` or `%` in the cell as wildcards', async () => {
    await seedRecord('AX100')
    const lookup = await build(['A_100', '%100'])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'A_100' })).resolves.toEqual({ kind: 'none' })
    await expect(lookup.find({ part_sku: '%100' })).resolves.toEqual({ kind: 'none' })
    expect(fallbackCalls).toBe(0)
  })

  it('reports a value that matches nothing as `none`, without a per-row query', async () => {
    await seedRecord('M400L')
    const lookup = await build(['M400L', 'NOT-IN-THE-DATABASE'])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'NOT-IN-THE-DATABASE' })).resolves.toEqual({
      kind: 'none',
    })
    expect(fallbackCalls).toBe(0)
  })

  // The batched path counts the REAL number of matches. The per-row path caps
  // at `limit(2)`, so it can only ever say "2"; nothing here is capped.
  it('reports ambiguity with the real count, not a capped one', async () => {
    await seedRecord('M400L')
    await seedRecord('M400L')
    await seedRecord('M400L')
    const lookup = await build(['M400L'])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({
      kind: 'ambiguous',
      count: 3,
    })
  })

  it('folds case before counting, so `M400L` and `m400l` are ONE ambiguity', async () => {
    await seedRecord('M400L')
    await seedRecord('m400l')
    const lookup = await build(['M400L'])

    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({
      kind: 'ambiguous',
      count: 2,
    })
  })

  // A multi-value field stores one FieldValue row per value; two rows on ONE
  // record must not read as two records.
  it('does not report ambiguity when one record carries the value twice', async () => {
    const id = await seedRecord('M400L')
    await db.insert(schema.FieldValue).values({
      id: generateId(),
      organizationId,
      fieldId: skuFieldId,
      entityId: id,
      entityDefinitionId: partDefId,
      valueText: 'M400L',
      sortKey: 'b',
      updatedAt: new Date(),
    } as typeof schema.FieldValue.$inferInsert)

    const lookup = await build(['M400L'])
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({ kind: 'one', recordId: id })
  })

  it('never resolves an archived record', async () => {
    await seedRecord('M400L', { archived: true })
    const lookup = await build(['M400L'])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({ kind: 'none' })
  })

  it('is organization-scoped', async () => {
    const otherDef = await seedDef(otherOrganizationId, 'part')
    const otherField = await seedField(otherOrganizationId, otherDef)
    await seedRecord('M400L', {
      orgId: otherOrganizationId,
      defId: otherDef,
      fieldId: otherField,
    })

    const lookup = await build(['M400L'])
    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({ kind: 'none' })
  })

  it('is entity-definition-scoped', async () => {
    const contactField = await seedField(organizationId, otherDefId)
    await seedRecord('M400L', { defId: otherDefId, fieldId: contactField })

    const lookup = await build(['M400L'])
    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({ kind: 'none' })
  })

  // Match-ANY over a split cell. `analyzeRow` calls the resolver once per
  // ELEMENT, so every element has to be in the index or the pre-pass has bought
  // nothing for exactly the rows that need it most.
  it('indexes every element of a split cell', async () => {
    const first = await seedRecord('M400L')
    const second = await seedRecord('M401L')
    const resolutions = new Map([splitResolution('M400L;M401L', ['M400L', 'M401L'])])

    const lookup = await build(['M400L;M401L'], resolutions)

    expect(lookup.batched).toBe(true)
    expect(lookup.queryCount).toBe(1)
    // The raw cell itself is NOT an identifier value for a split resolution —
    // only its elements are.
    expect(lookup.indexedValues).toBe(2)

    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({
      kind: 'one',
      recordId: first,
    })
    await expect(lookup.find({ part_sku: 'M401L' })).resolves.toEqual({
      kind: 'one',
      recordId: second,
    })
    expect(fallbackCalls).toBe(0)
  })

  // The safety net. A value the pre-pass never saw must be ASKED, never
  // answered `none` from an index that does not contain it.
  it('falls back to a real query for a value it never indexed', async () => {
    const id = await seedRecord('M400L')
    const lookup = await build(['M401L'])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({ kind: 'one', recordId: id })
    expect(fallbackCalls).toBe(1)
  })

  it('chunks the value list rather than binding a whole file into one statement', async () => {
    const id = await seedRecord('M400L')
    // 1000 is the chunk size, so 1200 distinct values must be two statements.
    const cells = Array.from({ length: 1199 }, (_, i) => `SKU-${i}`)
    const lookup = await build([...cells, 'M400L'])

    expect(lookup.batched).toBe(true)
    expect(lookup.indexedValues).toBe(1200)
    expect(lookup.queryCount).toBe(2)
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({ kind: 'one', recordId: id })
    expect(fallbackCalls).toBe(0)
  })

  it('agrees with the per-row resolver value for value', async () => {
    const matched = await seedRecord('M400L')
    await seedRecord('DUPE')
    await seedRecord('DUPE')

    const cells = ['M400L', 'm400l', 'DUPE', 'MISSING', 'A_100']
    const lookup = await build(cells)
    const perRow = createFindExistingRecord({
      db: db as never,
      organizationId,
      resource: resource(),
      identifierFields: [skuField()],
    })

    for (const cell of cells) {
      const batched = await lookup.find({ part_sku: cell })
      await expect(perRow({ part_sku: cell })).resolves.toEqual(batched)
    }
    await expect(lookup.find({ part_sku: 'M400L' })).resolves.toEqual({
      kind: 'one',
      recordId: matched,
    })
  })
})

/**
 * The `dbColumn === 'id'` lane. It matters more than its size suggests: until an
 * identifier can really be picked, the planner's auto-selected default IS the
 * Record ID, so this is the batched query most imports actually run.
 */
describe('createBatchedFindExistingRecord, Record ID lane', () => {
  let db: ReturnType<typeof getTestDb>
  let organizationId: string
  let partDefId: string
  let contactDefId: string

  const RECORD_ID_FIELD = {
    id: 'id',
    key: 'id',
    dbColumn: 'id',
    type: BaseType.STRING,
  } as unknown as ResourceField

  const seedDef = async (orgId: string, slug: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.EntityDefinition).values({
      id,
      organizationId: orgId,
      apiSlug: slug,
      singular: slug,
      plural: `${slug}s`,
      updatedAt: new Date(),
    } as typeof schema.EntityDefinition.$inferInsert)
    return id
  }

  const seedInstance = async (defId: string, archived = false): Promise<string> => {
    const id = generateId()
    await db.insert(schema.EntityInstance).values({
      id,
      organizationId,
      entityDefinitionId: defId,
      archivedAt: archived ? new Date() : null,
      updatedAt: new Date(),
    } as typeof schema.EntityInstance.$inferInsert)
    return id
  }

  const build = async (cells: string[]): Promise<BatchedIdentifierLookup> => {
    const resource = {
      id: 'part',
      type: 'custom',
      entityDefinitionId: partDefId,
    } as unknown as Resource
    const identifierFields = [RECORD_ID_FIELD]
    return createBatchedFindExistingRecord({
      db: db as never,
      organizationId,
      resource,
      identifierFields,
      rawData: new Map(cells.map((cell, index) => [index, { 0: cell }])),
      mappings: [
        {
          id: 'prop-id',
          importMappingId: 'mapping-1',
          sourceColumnIndex: 0,
          sourceColumnName: 'Record ID',
          targetType: 'particle',
          targetFieldKey: 'id',
          customFieldId: null,
          resolutionType: 'text:cuid',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as ImportMappingProperty,
      ],
      resolutions: new Map(),
      fallback: createFindExistingRecord({
        db: db as never,
        organizationId,
        resource,
        identifierFields,
      }),
    })
  }

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
    partDefId = await seedDef(organizationId, 'part')
    contactDefId = await seedDef(organizationId, 'contact')
  })

  it('resolves a whole file of record ids in one query', async () => {
    const first = await seedInstance(partDefId)
    const second = await seedInstance(partDefId)
    const lookup = await build([first, second, first])

    expect(lookup.batched).toBe(true)
    expect(lookup.queryCount).toBe(1)
    await expect(lookup.find({ id: first })).resolves.toEqual({ kind: 'one', recordId: first })
    await expect(lookup.find({ id: second })).resolves.toEqual({ kind: 'one', recordId: second })
  })

  it('tolerates a prefixed record id', async () => {
    const id = await seedInstance(partDefId)
    const lookup = await build([`part:${id}`])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ id: `part:${id}` })).resolves.toEqual({ kind: 'one', recordId: id })
  })

  // A cuid is unique across the WHOLE EntityInstance table, so the definition
  // predicate is what stops a `part` import from updating a `contact`.
  it('does NOT match an instance of another entity definition', async () => {
    const id = await seedInstance(contactDefId)
    const lookup = await build([id])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ id })).resolves.toEqual({ kind: 'none' })
  })

  it('never resolves an archived instance', async () => {
    const id = await seedInstance(partDefId, true)
    const lookup = await build([id])

    expect(lookup.batched).toBe(true)
    await expect(lookup.find({ id })).resolves.toEqual({ kind: 'none' })
  })
})

/**
 * The two shapes the pre-pass deliberately does NOT batch. Both must hand back
 * the per-row resolver untouched — degrading to today's behaviour is fine,
 * answering from an index that never covered them is not.
 */
describe('createBatchedFindExistingRecord, cases that stay per-row', () => {
  let db: ReturnType<typeof getTestDb>
  let organizationId: string

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
  })

  const field = (key: string): ResourceField =>
    ({ id: `f-${key}`, key, type: BaseType.STRING }) as unknown as ResourceField

  const fallback: FindExistingRecord = async () => ({ kind: 'none' })

  it('leaves a COMPOSITE key on the per-row path', async () => {
    const lookup = await createBatchedFindExistingRecord({
      db: db as never,
      organizationId,
      resource: {
        id: 'part',
        type: 'custom',
        entityDefinitionId: 'def-part',
      } as unknown as Resource,
      identifierFields: [field('part_sku'), field('supplier')],
      rawData: new Map([[0, { 0: 'M400L' }]]),
      mappings: MAPPINGS,
      resolutions: new Map(),
      fallback,
    })

    expect(lookup.batched).toBe(false)
    expect(lookup.queryCount).toBe(0)
    expect(lookup.find).toBe(fallback)
  })

  it('leaves a SYSTEM-table resource on the per-row path', async () => {
    const lookup = await createBatchedFindExistingRecord({
      db: db as never,
      organizationId,
      resource: { id: 'participant', type: 'system' } as unknown as Resource,
      identifierFields: [field('identifier')],
      rawData: new Map([[0, { 0: 'a@acme.test' }]]),
      mappings: MAPPINGS,
      resolutions: new Map(),
      fallback,
    })

    expect(lookup.batched).toBe(false)
    expect(lookup.find).toBe(fallback)
  })
})
