// packages/lib/src/data-connectors/preflight/__tests__/lookup.test.ts
// `findPartsBySkusForField` — the chunked `FieldValue` read, tested directly
// (no org cache, no `findPartsBySkus` entry point) with a hand-written db
// double per `files/__tests__/support/` model.

import { describe, expect, it } from 'vitest'
import { findPartsBySkusForField } from '../lookup'
import { makeFakeDb } from './support/db'

describe('findPartsBySkusForField', () => {
  it('returns no rows and issues no query for an empty or all-blank SKU list', async () => {
    const { db, selectCalls } = makeFakeDb()
    expect(await findPartsBySkusForField(db, 'org_1', 'def_part', 'field_sku', [])).toEqual([])
    expect(await findPartsBySkusForField(db, 'org_1', 'def_part', 'field_sku', ['  ', ''])).toEqual(
      []
    )
    expect(selectCalls()).toBe(0)
  })

  it('returns matching parts, including an archived one, from a single chunk', async () => {
    const { db } = makeFakeDb({
      select: [
        [
          { id: 'part_1', sku: 'LIFT-3000', archivedAt: null, displayName: 'Lift Motor 3000' },
          {
            id: 'part_2',
            sku: 'OLD-SKU',
            archivedAt: new Date('2025-01-01T00:00:00.000Z'),
            displayName: 'Old Part (archived)',
          },
        ],
      ],
    })

    const result = await findPartsBySkusForField(db, 'org_1', 'def_part', 'field_sku', [
      'LIFT-3000',
      'OLD-SKU',
      'NO-MATCH',
    ])

    expect(result).toEqual([
      { id: 'part_1', sku: 'LIFT-3000', archivedAt: null, displayName: 'Lift Motor 3000' },
      {
        id: 'part_2',
        sku: 'OLD-SKU',
        archivedAt: new Date('2025-01-01T00:00:00.000Z'),
        displayName: 'Old Part (archived)',
      },
    ])
  })

  it('chunks a large SKU list rather than building one giant IN clause', async () => {
    const skus = Array.from({ length: 2500 }, (_, i) => `SKU-${i}`)
    const { db, selectCalls } = makeFakeDb({ select: [[], [], []] })

    await findPartsBySkusForField(db, 'org_1', 'def_part', 'field_sku', skus)

    // 2500 distinct SKUs over a 1000-per-statement chunk size ⇒ 3 statements.
    expect(selectCalls()).toBe(3)
  })

  it('trims and de-duplicates candidate SKUs before binding them', async () => {
    const { db, selectCalls } = makeFakeDb({
      select: [[{ id: 'part_1', sku: 'A', archivedAt: null, displayName: 'A' }]],
    })

    const result = await findPartsBySkusForField(db, 'org_1', 'def_part', 'field_sku', [
      ' A ',
      'A',
      'A ',
    ])

    expect(selectCalls()).toBe(1)
    expect(result).toEqual([{ id: 'part_1', sku: 'A', archivedAt: null, displayName: 'A' }])
  })
})
