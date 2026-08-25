// packages/lib/src/import/mapping/__tests__/identifier-lifecycle.test.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it } from 'vitest'
import { BadRequestError } from '../../../errors'
import type { ImportStrategyMode } from '../../types/mapping'
import { deriveIdentifierFieldKeys, syncMappingIdentity } from '../derive-identifier-keys'
import {
  batchUpdateMappingsFromAutoMap,
  type SaveMappingInput,
  saveMappingProperty,
} from '../save-mapping-property'
import { updateImportStrategy } from '../update-mapping'

/**
 * The lifecycle these tests pin is THE bug this whole area exists to fix.
 *
 * `identityRole` lives on the COLUMN (`ImportMappingProperty.resolutionConfig`)
 * while the match key lives on the JOB (`ImportMapping.identifierFieldKeys`).
 * Nothing keeps the two levels in sync unless every mapping write recomputes the
 * second from the first, and a stale key whose field has no mapped column makes
 * `analyzeRow` find no identifier value, so the import silently reverts to
 * create-only behind a wizard that says update is on.
 *
 * The fake below resolves the single-row read to the column under edit. That
 * is not a shortcut around a predicate: under the shared `@auxx/database` mock
 * every COLUMN reference is `undefined` (only TABLE references are memoized and
 * comparable), so a where-clause is structurally unreadable in this environment.
 * Tables are dispatched by reference, which is real; row selection inside one
 * table is driven by the column the call is for, which is deterministic.
 */

interface FakeProperty {
  sourceColumnIndex: number
  sourceColumnName: string | null
  targetType: 'particle' | 'skip'
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  resolutionConfig: string | null
}

interface FakeMapping {
  identifierFieldKeys: string[] | null
  defaultStrategy: string
}

function column(index: number, overrides: Partial<FakeProperty> = {}): FakeProperty {
  return {
    sourceColumnIndex: index,
    sourceColumnName: `Column ${index + 1}`,
    targetType: 'skip',
    targetFieldKey: null,
    customFieldId: null,
    resolutionType: 'text:value',
    resolutionConfig: null,
    ...overrides,
  }
}

class FakeDb {
  properties: FakeProperty[]
  mapping: FakeMapping
  /** Column the current write targets, see the file docblock. */
  focusColumn = 0
  /**
   * True on the handle `transaction()` hands its callback. Writes carry it, so a
   * nested helper that kept using the OUTER handle instead of the transaction
   * one is observable as {@link writesOutsideTransaction}, not merely invisible.
   */
  readonly isTransactionHandle: boolean
  /** Writes that ran on a handle no transaction was open on. */
  writesOutsideTransaction = 0
  /** Table the next `update()` should be made to fail on, or null. */
  failUpdatesOn: unknown = null
  /**
   * Column indexes the successive `ImportMappingProperty` updates target, in
   * call order. Opt-in and null by default, so every test written against the
   * single-{@link focusColumn} model is untouched.
   *
   * `batchUpdateMappingsFromAutoMap` writes one statement per mapped column, and
   * `focusColumn` alone routes all of them onto ONE row — which is fine while
   * exactly one column can carry the identity flag, and wrong the moment a
   * COMPOSITE key puts the flag on two. Without this, a natural-key test passes
   * or fails on which write happened to land last.
   */
  batchColumnOrder: number[] | null = null
  private batchCursor = 0

  constructor(properties: FakeProperty[], mapping: FakeMapping, isTransactionHandle = false) {
    this.properties = properties
    this.mapping = mapping
    this.isTransactionHandle = isTransactionHandle
  }

  /** The column the next property write lands on: the batch order, else the focus. */
  private nextPropertyColumn(): number {
    if (this.batchColumnOrder === null) return this.focusColumn
    return this.batchColumnOrder[this.batchCursor++] ?? this.focusColumn
  }

  private rowsFor(table: unknown, limited: boolean): unknown[] {
    if (table === schema.ImportMapping) return [this.mapping]
    if (table === schema.ImportMappingProperty) {
      const sorted = [...this.properties].sort((a, b) => a.sourceColumnIndex - b.sourceColumnIndex)
      if (!limited) return sorted
      return sorted.filter((p) => p.sourceColumnIndex === this.focusColumn)
    }
    return []
  }

  private chain(table: unknown, limited = false): Record<string, unknown> {
    const node: Record<string, unknown> = {
      where: () => this.chain(table, limited),
      orderBy: () => this.chain(table, limited),
      limit: () => this.chain(table, true),
      for: () => this.chain(table, limited),
      // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder IS thenable, the fake has to be too, or `await db.select()...` never resolves.
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(this.rowsFor(table, limited)).then(resolve, reject),
    }
    return node
  }

  select() {
    return { from: (table: unknown) => this.chain(table) }
  }

  update(table: unknown) {
    const self = this
    return {
      set(values: Record<string, unknown>) {
        return {
          where: () => {
            if (!self.isTransactionHandle) self.writesOutsideTransaction += 1
            if (self.failUpdatesOn !== null && table === self.failUpdatesOn) {
              return Promise.reject(new Error('write failed'))
            }
            if (table === schema.ImportMapping) Object.assign(self.mapping, values)
            if (table === schema.ImportMappingProperty) {
              // Resolved ONCE per write, deliberately. `nextPropertyColumn` advances
              // a cursor, and `Array.find` runs its predicate once per element — so
              // calling it inline would consume several slots per statement and
              // scatter the writes across the wrong rows.
              const col = self.nextPropertyColumn()
              const target = self.properties.find((p) => p.sourceColumnIndex === col)
              if (target) Object.assign(target, values)
            }
            return Promise.resolve()
          },
        }
      },
    }
  }

  /**
   * Models the ONE property of a real transaction these tests are about: on a
   * throw, every write made inside is undone. Nothing else here rolls back, so
   * an implementation that stopped wrapping its statements would fail the
   * rollback test rather than pass it vacuously.
   */
  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    const propertiesBefore = this.properties.map((property) => ({ ...property }))
    const mappingBefore = { ...this.mapping }
    // Shares the row objects by reference, so writes land on the parent's state
    // and the assertions below read one store, not two.
    const tx = new FakeDb(this.properties, this.mapping, true)
    tx.focusColumn = this.focusColumn
    tx.failUpdatesOn = this.failUpdatesOn
    tx.batchColumnOrder = this.batchColumnOrder
    try {
      return await fn(tx.asDatabase())
    } catch (error) {
      this.properties.forEach((property, index) => Object.assign(property, propertiesBefore[index]))
      Object.assign(this.mapping, mappingBefore)
      throw error
    } finally {
      this.writesOutsideTransaction += tx.writesOutsideTransaction
    }
  }

  asDatabase(): Database {
    return this as unknown as Database
  }
}

const MAPPING_ID = 'mapping_1'

/** Drives `saveMappingProperty` with the fake focused on the column under edit. */
async function save(db: FakeDb, input: Omit<SaveMappingInput, 'mappingId'>) {
  db.focusColumn = input.columnIndex
  await saveMappingProperty(db.asDatabase(), { mappingId: MAPPING_ID, ...input })
}

const mapTo = (
  columnIndex: number,
  targetFieldKey: string | null,
  extra: Partial<SaveMappingInput> = {}
): Omit<SaveMappingInput, 'mappingId'> => ({
  columnIndex,
  targetFieldKey,
  customFieldId: null,
  resolutionType: 'text:value',
  ...extra,
})

describe('identifier lifecycle, the per-column flag drives the per-job key', () => {
  let db: FakeDb

  beforeEach(() => {
    db = new FakeDb(
      [
        column(0, { sourceColumnName: 'SKU' }),
        column(1, { sourceColumnName: 'Title' }),
        column(2, { sourceColumnName: 'Email' }),
      ],
      { identifierFieldKeys: [], defaultStrategy: 'create' }
    )
  })

  it('writes identifierFieldKeys when a column is flagged match', async () => {
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))

    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku'])
    expect(await deriveIdentifierFieldKeys(db.asDatabase(), MAPPING_ID)).toEqual(['part_sku'])
  })

  it('CLEARS the key when the flagged column is unmapped', async () => {
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))
    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku'])

    await save(db, mapTo(0, null))

    expect(db.mapping.identifierFieldKeys).toEqual([])
    // The role is gone from the column too, not merely ignored downstream.
    expect(db.properties[0]?.resolutionConfig).toBeNull()
  })

  it('CLEARS the key when the flagged column is retargeted to another field', async () => {
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))

    // Same column, different field, and the caller says nothing about the flag.
    await save(db, mapTo(0, 'part_title'))

    expect(db.mapping.identifierFieldKeys).toEqual([])
    expect(db.properties[0]?.resolutionConfig).toBeNull()
  })

  it('PRESERVES the flag across an unrelated re-save of the same column', async () => {
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))

    // A resolution-type change resends everything EXCEPT identityRole. Rebuilding
    // resolutionConfig from input alone is what used to drop it here.
    await save(db, mapTo(0, 'part_sku', { resolutionType: 'text:cuid' }))

    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku'])
  })

  it('builds an ordered two-element key from two flagged columns (composite)', async () => {
    await save(db, mapTo(2, 'primary_email', { identityRole: { kind: 'match' } }))
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))

    // Ordered by SOURCE COLUMN INDEX, not by the order the user clicked.
    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku', 'primary_email'])
  })

  it('drops the flag explicitly when identityRole is null', async () => {
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))
    await save(db, mapTo(0, 'part_sku', { identityRole: null }))

    expect(db.mapping.identifierFieldKeys).toEqual([])
  })

  it('never persists the connector normalize knob', async () => {
    await save(
      db,
      mapTo(0, 'part_sku', {
        // The router's schema refuses this shape; lib strips it again anyway,
        // because a user-settable third normalization authority is the only one
        // a human can desync from normalizeForLookup by hand.
        identityRole: { kind: 'match', normalize: 'email' } as never,
      })
    )

    const stored = JSON.parse(db.properties[0]?.resolutionConfig ?? '{}')
    expect(stored.identityRole).toEqual({ kind: 'match' })
  })
})

describe('mode auto-flip', () => {
  const freshDb = (defaultStrategy: ImportStrategyMode = 'create') =>
    new FakeDb([column(0, { sourceColumnName: 'SKU' }), column(1)], {
      identifierFieldKeys: [],
      defaultStrategy,
    })

  it('flips create → create-or-update on the FIRST identifier', async () => {
    const db = freshDb()
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))

    expect(db.mapping.defaultStrategy).toBe('create-or-update')
  })

  it('flips back to create when the LAST identifier is cleared', async () => {
    const db = freshDb()
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))
    await save(db, mapTo(0, null))

    // `update` / `create-or-update` without a match key can match nothing at all.
    expect(db.mapping.defaultStrategy).toBe('create')
  })

  it('never stomps an explicit choice made while an identifier already exists', async () => {
    const db = freshDb()
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))
    expect(db.mapping.defaultStrategy).toBe('create-or-update')

    // The user deliberately goes back to create-only, keeping the identifier column.
    await updateImportStrategy(db.asDatabase(), { mappingId: MAPPING_ID, mode: 'create' })

    // Editing ANY unrelated column must not re-flip it: the identifier set was
    // already non-empty, so this is not the empty → non-empty transition.
    await save(db, mapTo(1, 'part_title'))

    expect(db.mapping.defaultStrategy).toBe('create')
  })

  it('leaves an explicit update mode alone when a second identifier is added', async () => {
    const db = freshDb()
    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))
    await updateImportStrategy(db.asDatabase(), { mappingId: MAPPING_ID, mode: 'update' })
    await save(db, mapTo(1, 'part_title', { identityRole: { kind: 'match' } }))

    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku', 'part_title'])
    expect(db.mapping.defaultStrategy).toBe('update')
  })

  it('reads a legacy skip mode as create rather than crashing', async () => {
    const db = new FakeDb([column(0)], {
      identifierFieldKeys: [],
      defaultStrategy: 'skip',
    })

    const state = await syncMappingIdentity(db.asDatabase(), MAPPING_ID)

    expect(state.defaultStrategy).toBe('create')
  })

  it('rejects a mode outside the three live members', async () => {
    const db = freshDb()
    await expect(
      updateImportStrategy(db.asDatabase(), {
        mappingId: MAPPING_ID,
        mode: 'skip' as never,
      })
    ).rejects.toBeInstanceOf(BadRequestError)
  })
})

describe('mergeStrategy validation', () => {
  it('rejects the connector-only strategies at the lib boundary', async () => {
    const db = new FakeDb([column(0)], { identifierFieldKeys: [], defaultStrategy: 'create' })

    for (const strategy of ['connector_owned_only', 'manual_review'] as const) {
      await expect(
        save(db, mapTo(0, 'part_sku', { mergeStrategy: strategy as never }))
      ).rejects.toBeInstanceOf(BadRequestError)
    }
  })

  it('accepts the import subset and drops it on retarget', async () => {
    const db = new FakeDb([column(0)], { identifierFieldKeys: [], defaultStrategy: 'create' })

    await save(db, mapTo(0, 'part_sku', { mergeStrategy: 'fill_blank' }))
    expect(JSON.parse(db.properties[0]?.resolutionConfig ?? '{}').mergeStrategy).toBe('fill_blank')

    // The policy is about the TARGET FIELD, so it cannot follow the column onto
    // a different one.
    await save(db, mapTo(0, 'part_title'))
    expect(db.properties[0]?.resolutionConfig).toBeNull()
  })
})

describe('batchUpdateMappingsFromAutoMap', () => {
  it('clears stale roles and defaults the flag ON for the best tier-1 target', async () => {
    const db = new FakeDb(
      [
        // A leftover flag from before auto-map ran, on a column that is about to
        // be retargeted. Left alone it silently becomes part of the match key.
        column(0, {
          targetType: 'particle',
          targetFieldKey: 'part_title',
          resolutionConfig: JSON.stringify({ identityRole: { kind: 'match' } }),
        }),
        column(1),
      ],
      { identifierFieldKeys: ['part_title'], defaultStrategy: 'create-or-update' }
    )

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [
        {
          columnIndex: 0,
          matchedFieldKey: 'part_title',
          customFieldId: null,
          resolutionType: 'text:value',
        },
        {
          columnIndex: 1,
          matchedFieldKey: 'part_sku',
          customFieldId: null,
          resolutionType: 'text:value',
        },
      ],
      // Picker order: a real identifier before Record ID.
      preferredIdentifierFieldKeys: ['part_sku', 'id'],
    })

    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku'])
  })

  it('flags exactly ONE column even when several tier-1 identifiers are mapped', async () => {
    const db = new FakeDb([column(0), column(1)], {
      identifierFieldKeys: [],
      defaultStrategy: 'create',
    })

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [
        {
          columnIndex: 0,
          matchedFieldKey: 'id',
          customFieldId: null,
          resolutionType: 'text:value',
        },
        {
          columnIndex: 1,
          matchedFieldKey: 'part_sku',
          customFieldId: null,
          resolutionType: 'text:value',
        },
      ],
      preferredIdentifierFieldKeys: ['part_sku', 'id'],
    })

    // A composite key is a deliberate user act, never a guess: `(sku AND id)`
    // from an auto-map would match nothing at all.
    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku'])
    expect(db.mapping.defaultStrategy).toBe('create-or-update')
  })

  it('leaves the key empty when no preferred identifier was mapped', async () => {
    const db = new FakeDb([column(0)], { identifierFieldKeys: [], defaultStrategy: 'create' })

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [
        {
          columnIndex: 0,
          matchedFieldKey: 'part_title',
          customFieldId: null,
          resolutionType: 'text:value',
        },
      ],
      preferredIdentifierFieldKeys: ['part_sku'],
    })

    expect(db.mapping.identifierFieldKeys).toEqual([])
    expect(db.mapping.defaultStrategy).toBe('create')
  })
})

describe('deriveIdentifierFieldKeys', () => {
  it('ignores a flagged column that is not actually mapped', async () => {
    // The stale-key failure in its purest form: the flag survives on a column
    // whose target was cleared out of band.
    const db = new FakeDb(
      [
        column(0, {
          targetType: 'skip',
          targetFieldKey: 'part_sku',
          resolutionConfig: JSON.stringify({ identityRole: { kind: 'match' } }),
        }),
      ],
      { identifierFieldKeys: ['part_sku'], defaultStrategy: 'create-or-update' }
    )

    expect(await deriveIdentifierFieldKeys(db.asDatabase(), MAPPING_ID)).toEqual([])
  })

  it('ignores an externalId role, only match is the match key', async () => {
    const db = new FakeDb(
      [
        column(0, {
          targetType: 'particle',
          targetFieldKey: 'external_id',
          resolutionConfig: JSON.stringify({ identityRole: { kind: 'externalId' } }),
        }),
      ],
      { identifierFieldKeys: [], defaultStrategy: 'create' }
    )

    expect(await deriveIdentifierFieldKeys(db.asDatabase(), MAPPING_ID)).toEqual([])
  })

  it('survives an unparseable resolutionConfig', async () => {
    const db = new FakeDb(
      [
        column(0, { targetType: 'particle', targetFieldKey: 'a', resolutionConfig: '{not json' }),
        column(1, {
          targetType: 'particle',
          targetFieldKey: 'b',
          resolutionConfig: JSON.stringify({ identityRole: { kind: 'match' } }),
        }),
      ],
      { identifierFieldKeys: [], defaultStrategy: 'create' }
    )

    expect(await deriveIdentifierFieldKeys(db.asDatabase(), MAPPING_ID)).toEqual(['b'])
  })
})

describe('atomicity, every mapping write is one transaction', () => {
  /**
   * The column flag and the job-level match key are written by two different
   * statements against two different tables. Left unwrapped, a failure between
   * them stores a flag whose key was never recomputed, which is the same stale
   * state the whole module exists to prevent, just reached from the other side.
   */
  it('rolls the column write back when a later statement in saveMappingProperty fails', async () => {
    const db = new FakeDb([column(0, { sourceColumnName: 'SKU' })], {
      identifierFieldKeys: [],
      defaultStrategy: 'create',
    })
    // The LAST statement of the sequence, so the column write and the identity
    // recompute have both already happened when it blows up.
    db.failUpdatesOn = schema.ImportJob

    await expect(
      save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))
    ).rejects.toThrow('write failed')

    expect(db.properties[0]?.targetFieldKey).toBeNull()
    expect(db.properties[0]?.resolutionConfig).toBeNull()
    expect(db.mapping.identifierFieldKeys).toEqual([])
    expect(db.mapping.defaultStrategy).toBe('create')
  })

  it('rolls every column back when one write inside the auto-map batch fails', async () => {
    const db = new FakeDb([column(0), column(1)], {
      identifierFieldKeys: [],
      defaultStrategy: 'create',
    })
    db.failUpdatesOn = schema.ImportJob

    await expect(
      batchUpdateMappingsFromAutoMap(db.asDatabase(), {
        mappingId: MAPPING_ID,
        mappings: [
          {
            columnIndex: 0,
            matchedFieldKey: 'part_sku',
            customFieldId: null,
            resolutionType: 'text:value',
          },
        ],
        preferredIdentifierFieldKeys: ['part_sku'],
      })
    ).rejects.toThrow('write failed')

    expect(db.properties[0]?.targetFieldKey).toBeNull()
    expect(db.mapping.identifierFieldKeys).toEqual([])
  })

  /**
   * `syncMappingIdentity` is declared `db: Database`, so a call that forgot to
   * pass the transaction handle would still compile and still work — it would
   * just run its read-modify-write on its own connection, outside the caller's
   * transaction, which is exactly the lost update the wrapping was added to
   * close. The fake counts writes made on a non-transaction handle so that
   * regression is visible instead of silent.
   */
  it('runs the nested identity recompute on the transaction handle', async () => {
    const db = new FakeDb([column(0, { sourceColumnName: 'SKU' })], {
      identifierFieldKeys: [],
      defaultStrategy: 'create',
    })

    await save(db, mapTo(0, 'part_sku', { identityRole: { kind: 'match' } }))

    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku'])
    expect(db.writesOutsideTransaction).toBe(0)
  })

  it('runs the auto-map batch entirely on the transaction handle', async () => {
    const db = new FakeDb([column(0)], { identifierFieldKeys: [], defaultStrategy: 'create' })

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [
        {
          columnIndex: 0,
          matchedFieldKey: 'part_sku',
          customFieldId: null,
          resolutionType: 'text:value',
        },
      ],
      preferredIdentifierFieldKeys: ['part_sku'],
    })

    expect(db.writesOutsideTransaction).toBe(0)
  })

  // ── declared natural key ──────────────────────────────────────────────
  //
  // The one composite key that may be DEFAULTED, because the registry states it
  // rather than the mapper guessing it. `vendor_part` has no lone identifier at
  // all, so without this a supplier price list can only ever duplicate.

  const vendorPartMappings = [
    {
      columnIndex: 0,
      matchedFieldKey: 'vendor_part_part',
      customFieldId: null,
      resolutionType: 'relation:match',
    },
    {
      columnIndex: 1,
      matchedFieldKey: 'vendor_part_contact',
      customFieldId: null,
      resolutionType: 'relation:match',
    },
    {
      columnIndex: 2,
      matchedFieldKey: 'vendor_part_unit_price',
      customFieldId: null,
      resolutionType: 'currency:major',
    },
  ]

  it('flags EVERY leg when the whole natural key was mapped', async () => {
    const db = new FakeDb([column(0), column(1), column(2)], {
      identifierFieldKeys: [],
      defaultStrategy: 'create',
    })
    db.batchColumnOrder = [0, 1, 2]

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: vendorPartMappings,
      preferredIdentifierFieldKeys: ['id'],
      naturalKeyFieldKeys: ['vendor_part_part', 'vendor_part_contact'],
    })

    expect(new Set(db.mapping.identifierFieldKeys)).toEqual(
      new Set(['vendor_part_part', 'vendor_part_contact'])
    )
    expect(db.mapping.defaultStrategy).toBe('create-or-update')
  })

  // Half a tuple ANDs too little. `analyzeRow` requires every component, so a
  // partial key reports `unmatched` for every row behind a wizard claiming
  // update — strictly worse than staying create-only.
  it('flags NOTHING from a partially mapped natural key', async () => {
    const db = new FakeDb([column(0), column(1)], {
      identifierFieldKeys: [],
      defaultStrategy: 'create',
    })
    db.batchColumnOrder = [0, 1]

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [vendorPartMappings[0]!, vendorPartMappings[2]!],
      naturalKeyFieldKeys: ['vendor_part_part', 'vendor_part_contact'],
    })

    expect(db.mapping.identifierFieldKeys).toEqual([])
    expect(db.mapping.defaultStrategy).toBe('create')
  })

  // The natural key outranks the single-column pick rather than joining it: a
  // declared tuple plus a heuristic third leg is a key nobody declared.
  it('does not mix the natural key with the preferred single identifier', async () => {
    const db = new FakeDb([column(0), column(1), column(2)], {
      identifierFieldKeys: [],
      defaultStrategy: 'create',
    })
    db.batchColumnOrder = [0, 1, 2]

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [
        ...vendorPartMappings.slice(0, 2),
        {
          columnIndex: 2,
          matchedFieldKey: 'vendor_part_vendor_sku',
          customFieldId: null,
          resolutionType: 'text:value',
        },
      ],
      preferredIdentifierFieldKeys: ['vendor_part_vendor_sku'],
      naturalKeyFieldKeys: ['vendor_part_part', 'vendor_part_contact'],
    })

    expect(new Set(db.mapping.identifierFieldKeys)).toEqual(
      new Set(['vendor_part_part', 'vendor_part_contact'])
    )
  })

  // Every other resource is unaffected: no declaration, no behaviour change.
  it('falls back to the single preferred identifier when no natural key is declared', async () => {
    const db = new FakeDb([column(0), column(1)], {
      identifierFieldKeys: [],
      defaultStrategy: 'create',
    })
    db.batchColumnOrder = [0, 1]

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [
        {
          columnIndex: 0,
          matchedFieldKey: 'part_sku',
          customFieldId: null,
          resolutionType: 'text:value',
        },
        {
          columnIndex: 1,
          matchedFieldKey: 'part_title',
          customFieldId: null,
          resolutionType: 'text:value',
        },
      ],
      preferredIdentifierFieldKeys: ['part_sku', 'id'],
      naturalKeyFieldKeys: [],
    })

    expect(db.mapping.identifierFieldKeys).toEqual(['part_sku'])
  })
})

/**
 * The half auto-map cannot cover.
 *
 * `batchUpdateMappingsFromAutoMap` defaults the declared natural key on, and for
 * a long time only it did — so a mapping the user REPAIRED came out with no
 * match key at all. That is not an edge case: a mis-mapped key column is the
 * reason anyone opens the mapping step to repair it, and `vendor_part` has no
 * lone identifier to fall back to. The supplier-price importer shipped whole
 * with `identifierFieldKeys: []` and `defaultStrategy: 'create'` this way, which
 * is a monthly price list appending its rows instead of updating them.
 *
 * `batchColumnOrder` is load-bearing here for the reason its own docblock gives:
 * completing the key writes the flag onto SEVERAL columns in one call, and the
 * single-`focusColumn` model would land all of them on one row.
 */
describe('natural key defaults on after a hand REPAIR', () => {
  /** `(part, supplier)` — the legs `vendor-part-fields.ts` declares. */
  const VENDOR_PART_KEY = ['vendor_part_part', 'vendor_part_contact']

  /** Two unmapped columns and a mapping with no identity, as after a bad auto-map. */
  function freshDb() {
    return new FakeDb(
      [
        column(0, { sourceColumnName: 'Part' }),
        column(1, { sourceColumnName: 'Supplier' }),
        column(2, { sourceColumnName: 'Vendor SKU' }),
      ],
      { identifierFieldKeys: [], defaultStrategy: 'create' }
    )
  }

  it('fires when the LAST leg is mapped, and flips the mode to create-or-update', async () => {
    const db = freshDb()

    // First leg: the tuple is still incomplete, so nothing is flagged yet.
    db.batchColumnOrder = [0]
    await save(db, mapTo(0, 'vendor_part_part', { naturalKeyFieldKeys: VENDOR_PART_KEY }))
    expect(db.mapping.identifierFieldKeys).toEqual([])
    expect(db.mapping.defaultStrategy).toBe('create')

    // Second leg completes it: the column write, then one write per leg.
    db.batchColumnOrder = [1, 0, 1]
    await save(db, mapTo(1, 'vendor_part_contact', { naturalKeyFieldKeys: VENDOR_PART_KEY }))

    expect(db.mapping.identifierFieldKeys).toEqual(VENDOR_PART_KEY)
    expect(db.mapping.defaultStrategy).toBe('create-or-update')
  })

  it('leaves a PARTIAL key alone — half a tuple matches nothing', async () => {
    const db = freshDb()

    db.batchColumnOrder = [0]
    await save(db, mapTo(0, 'vendor_part_part', { naturalKeyFieldKeys: VENDOR_PART_KEY }))

    expect(db.mapping.identifierFieldKeys).toEqual([])
    expect(db.mapping.defaultStrategy).toBe('create')
  })

  it('never overrides an identity the mapping already has', async () => {
    const db = freshDb()

    // The user's own pick, on a field that is not a leg.
    db.batchColumnOrder = [2]
    await save(
      db,
      mapTo(2, 'vendor_part_vendor_sku', {
        identityRole: { kind: 'match' },
        naturalKeyFieldKeys: VENDOR_PART_KEY,
      })
    )
    db.batchColumnOrder = [0]
    await save(db, mapTo(0, 'vendor_part_part', { naturalKeyFieldKeys: VENDOR_PART_KEY }))
    db.batchColumnOrder = [1]
    await save(db, mapTo(1, 'vendor_part_contact', { naturalKeyFieldKeys: VENDOR_PART_KEY }))

    expect(db.mapping.identifierFieldKeys).toEqual(['vendor_part_vendor_sku'])
  })

  it('does not undo an explicit clear of the last flag', async () => {
    const db = freshDb()

    db.batchColumnOrder = [0]
    await save(db, mapTo(0, 'vendor_part_part', { naturalKeyFieldKeys: VENDOR_PART_KEY }))
    db.batchColumnOrder = [1, 0, 1]
    await save(db, mapTo(1, 'vendor_part_contact', { naturalKeyFieldKeys: VENDOR_PART_KEY }))
    expect(db.mapping.identifierFieldKeys).toEqual(VENDOR_PART_KEY)

    // Clearing the legs one at a time must end at create-only and STAY there —
    // the default may not re-stamp the tuple the user just took off.
    db.batchColumnOrder = [0]
    await save(
      db,
      mapTo(0, 'vendor_part_part', { identityRole: null, naturalKeyFieldKeys: VENDOR_PART_KEY })
    )
    db.batchColumnOrder = [1]
    await save(
      db,
      mapTo(1, 'vendor_part_contact', { identityRole: null, naturalKeyFieldKeys: VENDOR_PART_KEY })
    )

    expect(db.mapping.identifierFieldKeys).toEqual([])
    expect(db.mapping.defaultStrategy).toBe('create')
  })

  it('is not resurrected by a save on an unrelated column', async () => {
    const db = freshDb()

    db.batchColumnOrder = [0]
    await save(db, mapTo(0, 'vendor_part_part', { naturalKeyFieldKeys: VENDOR_PART_KEY }))
    db.batchColumnOrder = [1]
    await save(
      db,
      mapTo(1, 'vendor_part_contact', { identityRole: null, naturalKeyFieldKeys: VENDOR_PART_KEY })
    )
    expect(db.mapping.identifierFieldKeys).toEqual([])

    // Both legs are mapped and the key is off. Editing a THIRD column is not a
    // statement about identity, so it may not turn the key back on.
    db.batchColumnOrder = [2]
    await save(db, mapTo(2, 'vendor_part_vendor_sku', { naturalKeyFieldKeys: VENDOR_PART_KEY }))

    expect(db.mapping.identifierFieldKeys).toEqual([])
  })

  it('completes a HALF tuple left behind by unmapping and re-mapping one leg', async () => {
    const db = freshDb()

    db.batchColumnOrder = [0]
    await save(db, mapTo(0, 'vendor_part_part', { naturalKeyFieldKeys: VENDOR_PART_KEY }))
    db.batchColumnOrder = [1, 0, 1]
    await save(db, mapTo(1, 'vendor_part_contact', { naturalKeyFieldKeys: VENDOR_PART_KEY }))
    expect(db.mapping.identifierFieldKeys).toEqual(VENDOR_PART_KEY)

    // Unmapping a leg drops its flag and leaves the OTHER leg flagged alone —
    // a key that can never match, since `analyzeRow` needs every component.
    db.batchColumnOrder = [0]
    await save(db, mapTo(0, null, { naturalKeyFieldKeys: VENDOR_PART_KEY }))
    expect(db.mapping.identifierFieldKeys).toEqual(['vendor_part_contact'])

    // Re-mapping it must restore the whole tuple, not sit next to the orphan.
    db.batchColumnOrder = [0, 0, 1]
    await save(db, mapTo(0, 'vendor_part_part', { naturalKeyFieldKeys: VENDOR_PART_KEY }))

    expect(db.mapping.identifierFieldKeys).toEqual(VENDOR_PART_KEY)
  })

  it('is inert for a resource that declares no natural key', async () => {
    const db = freshDb()

    db.batchColumnOrder = [0]
    await save(db, mapTo(0, 'contact_email'))
    db.batchColumnOrder = [1]
    await save(db, mapTo(1, 'contact_name'))

    expect(db.mapping.identifierFieldKeys).toEqual([])
    expect(db.mapping.defaultStrategy).toBe('create')
  })
})
