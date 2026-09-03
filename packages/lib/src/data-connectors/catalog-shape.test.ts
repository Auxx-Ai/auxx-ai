// packages/lib/src/data-connectors/catalog-shape.test.ts
// The seeder and `deriveStreamShape` agree (task 41 section 7): what
// `materializeAppContributingMappings` writes reads back into the same keys, bindings
// and hashes the derivation produces, and the normalization is what makes a persisted
// row comparable (entry ids dropped, app refs collapsed, binding order irrelevant).

import type { Database } from '@auxx/database'
import { toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCachedCustomFields, getCachedEntityDefId } from '../cache'
import {
  catalogFixtureV1,
  FIXTURE_DEF_FIELDS,
  FIXTURE_DEF_IDS,
  fixturePersistedContext,
  fixtureResolver,
  persistedRowsFromDerived,
} from './__test-helpers'
import {
  deriveConnectorShape,
  deriveStreamShape,
  hashMappingShape,
  hashStreamShape,
  normalizeBinding,
  normalizeTargetRef,
  shapeFromPersistedStreams,
} from './catalog-shape'
import { materializeAppContributingMappings } from './mutations'
import type { StreamWithRawMappings } from './service'
import type { FieldMapping } from './types'

vi.mock('../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cache')>()
  return {
    ...actual,
    getCachedEntityDefId: vi.fn(),
    getCachedCustomFields: vi.fn(),
  }
})

const ORG = 'org1'
const STREAM_ID = 's_product'

/** Drizzle stub: `addMapping`'s stream-guard findFirst + insert().values().returning(). */
function mockDb() {
  const inserted: Array<Record<string, unknown>> = []
  let n = 0
  const db = {
    query: {
      DataConnectorStream: {
        findFirst: vi.fn(async () => ({ id: STREAM_ID, organizationId: ORG })),
      },
    },
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: `m_${++n}`, ...v }
          inserted.push(row)
          return [row]
        },
      }),
    })),
  }
  return { db: db as unknown as Database, inserted }
}

beforeEach(() => {
  vi.mocked(getCachedEntityDefId).mockImplementation(async (_org, kind) => FIXTURE_DEF_IDS[kind])
  vi.mocked(getCachedCustomFields).mockImplementation(
    async (_org, defId) => (FIXTURE_DEF_FIELDS[defId] ?? []) as never
  )
})

describe('deriveStreamShape agrees with the seeder', () => {
  it('rows the seeder writes read back into the derived keys, bindings and hashes', async () => {
    const stream = catalogFixtureV1().streams[0]!
    const derived = deriveStreamShape(stream, 'shopify', [], fixtureResolver())

    const { db, inserted } = mockDb()
    await materializeAppContributingMappings(db, ORG, STREAM_ID, stream, 'shopify')
    expect(inserted).toHaveLength(3)

    // Every inserted row carries the hash of the derived mapping it came from.
    const derivedByHash = new Map(derived.mappings.map((m) => [hashMappingShape(m), m]))
    for (const row of inserted) {
      expect(derivedByHash.has(row.catalogHash as string)).toBe(true)
    }

    // Reading the rows back yields the same keys + normalized bindings, ids aside.
    const persistedStream = {
      id: STREAM_ID,
      streamKey: 'product',
      syncMode: 'incremental',
      requestConfig: null,
      sourceSchema: derived.sourceSchema,
      mappings: inserted,
    } as unknown as StreamWithRawMappings
    const [persisted] = shapeFromPersistedStreams([persistedStream], fixturePersistedContext())
    expect(persisted?.mappings.map((m) => m.shape.key).sort()).toEqual(
      derived.mappings.map((m) => m.key).sort()
    )
    for (const pm of persisted?.mappings ?? []) {
      const dm = derived.mappings.find((m) => m.key === pm.shape.key)
      expect(dm).toBeDefined()
      expect(pm.shape.bindings).toEqual(dm?.bindings)
      expect(hashMappingShape(pm.shape)).toBe(pm.row.catalogHash)
    }
  })

  it('keys a flat drilled child under its parent with rootPath "" and the system edge', () => {
    const stream = catalogFixtureV1().streams[0]!
    const derived = deriveStreamShape(stream, 'shopify', [], fixtureResolver())
    const part = derived.mappings.find((m) => m.targetKey === 'def_part')
    const catalog = derived.mappings.find((m) => m.targetKey === 'def_catalog')
    expect(part?.rootPath).toBe('variants[]')
    expect(catalog?.rootPath).toBe('')
    expect(catalog?.parentKey).toBe(part?.key)
    expect(catalog?.storedRelationshipFieldKey).toBe(toResourceFieldId('def_part', 'f_ci'))
    expect(part?.storedRelationshipFieldKey).toBe(toResourceFieldId('def_product', 'f_parts'))
  })

  it('deriveConnectorShape covers every stream, with the catalog source schema', () => {
    const streams = deriveConnectorShape(catalogFixtureV1(), [], 'shopify', fixtureResolver())
    expect(streams.map((s) => s.key)).toEqual(['product', 'customer'])
    expect(streams[1]?.syncMode).toBe('snapshot')
    expect(streams[1]?.sourceSchema).toMatchObject({ type: 'object' })
  })
})

describe('normalization + hashing', () => {
  const fieldsByDefId = fixtureResolver().fieldsByDefId

  it('collapses an app-provisioned field to its @app form from either ref shape', () => {
    // Late-bound (what the seeder writes) and concrete (what a later rewrite could store).
    expect(normalizeTargetRef('def_contact:@app:shopify:storeDomain', fieldsByDefId)).toBe(
      '@app:shopify:storeDomain'
    )
    expect(normalizeTargetRef('contacts:@app:shopify:storeDomain', fieldsByDefId)).toBe(
      '@app:shopify:storeDomain'
    )
    expect(normalizeTargetRef(toResourceFieldId('def_contact', 'f_store'), fieldsByDefId)).toBe(
      '@app:shopify:storeDomain'
    )
    // A system field keeps its concrete ref.
    expect(normalizeTargetRef(toResourceFieldId('def_contact', 'f_email'), fieldsByDefId)).toBe(
      'def_contact:f_email'
    )
    expect(normalizeTargetRef(null, fieldsByDefId)).toBeNull()
  })

  it('makes defaults explicit so an absent and an explicit overwrite hash equal', () => {
    const base: FieldMapping = {
      id: 'x',
      targetFieldRef: toResourceFieldId('def_part', 'f_sku'),
      expression: '{sku}',
      sourceFields: { sku: 'sku' },
    }
    expect(normalizeBinding(base, fieldsByDefId)).toEqual(
      normalizeBinding({ ...base, id: 'y', mergeStrategy: 'overwrite' }, fieldsByDefId)
    )
    expect(normalizeBinding({ ...base, identityRole: { kind: 'match' } }, fieldsByDefId)).toEqual(
      normalizeBinding(
        { ...base, identityRole: { kind: 'match', normalize: 'none', exclusive: false } },
        fieldsByDefId
      )
    )
  })

  it('hashes are independent of binding order and entry ids', () => {
    const stream = catalogFixtureV1().streams[1]!
    const a = deriveStreamShape(stream, 'shopify', [], fixtureResolver())
    const b = deriveStreamShape(stream, 'shopify', [], fixtureResolver())
    const [ma] = a.mappings
    const [mb] = b.mappings
    // Fresh generateId ids per derivation, same hash.
    expect(ma?.fieldMappings[0]?.id).not.toBe(mb?.fieldMappings[0]?.id)
    expect(hashMappingShape(ma!)).toBe(hashMappingShape(mb!))
    expect(hashStreamShape(a)).toBe(hashStreamShape(b))

    // Persisted rows with the entries reversed still hash the same.
    const rows = persistedRowsFromDerived([a])
    rows[0]!.mappings[0]!.fieldMappings = [...rows[0]!.mappings[0]!.fieldMappings].reverse()
    const [persisted] = shapeFromPersistedStreams(rows, fixturePersistedContext())
    expect(hashMappingShape(persisted!.mappings[0]!.shape)).toBe(hashMappingShape(ma!))
  })

  it('a changed merge strategy changes the hash', () => {
    const stream = catalogFixtureV1().streams[1]!
    const derived = deriveStreamShape(stream, 'shopify', [], fixtureResolver())
    const rows = persistedRowsFromDerived([derived])
    const contact = rows[0]!.mappings[0]!
    const first = contact.fieldMappings.find((fm) => fm.targetFieldRef?.endsWith('f_first'))!
    first.mergeStrategy = 'overwrite'
    const [persisted] = shapeFromPersistedStreams(rows, fixturePersistedContext())
    expect(hashMappingShape(persisted!.mappings[0]!.shape)).not.toBe(contact.catalogHash)
  })
})
