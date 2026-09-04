// packages/lib/src/seed/entity-migrations/migrations/124-build-batch-source-and-period.test.ts
//
// Migration 124 adds two `CustomField` rows and one option to a third, so what
// can silently go wrong is the wiring rather than the write:
//
//  - the id must be unique across a space shared with `data-migrations/`, which
//    has already collided once at 103;
//  - it must run after 109, which creates the `build` def and materializes the
//    two-value `build_source` option list it widens;
//  - the registry keys it names must exist, or it quietly creates one field
//    fewer than it claims to;
//  - the option append must preserve every stored entry, because
//    `FieldValue.optionId` stores the `value` key.

import { describe, expect, it } from 'vitest'
import { BuildSource } from '../../../resources/registry/enum-values'
import { BUILD_FIELDS } from '../../../resources/registry/resources/build-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import {
  appendMissingOptions,
  migration124BuildBatchSourceAndPeriod,
} from './124-build-batch-source-and-period'

const MIGRATION_ID = '124-build-batch-source-and-period'

describe('migration 124 registration', () => {
  it('is registered exactly once, with a unique id, after 109', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('109-build-and-standard-cost'))
    expect(migration124BuildBatchSourceAndPeriod.id).toBe(MIGRATION_ID)
  })

  it('sorts before 125, which took the next id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf(MIGRATION_ID)).toBeLessThan(ids.indexOf('125-accounting-books'))
  })
})

describe('BuildSource gains batch without disturbing what is already stored', () => {
  it('carries three values, with manual and order still first and in order', () => {
    expect(BuildSource.values.map((option) => option.value)).toEqual(['manual', 'order', 'batch'])
    expect(BuildSource.BATCH).toBe('batch')
  })

  it('gives batch a colour distinct from manual and order', () => {
    const colors = BuildSource.values.map((option) => option.color)
    expect(new Set(colors).size).toBe(colors.length)
  })
})

describe('appendMissingOptions', () => {
  const wanted = [
    { value: 'manual', label: 'Manual', color: 'gray' },
    { value: 'order', label: 'Order', color: 'blue' },
    { value: 'batch', label: 'Batch', color: 'purple' },
  ]

  it('appends only what is missing, preserving stored entries verbatim', () => {
    // A renamed label and a recoloured option: both are the org's, and a
    // wholesale rewrite from the registry would discard them.
    const stored = [
      { value: 'manual', label: 'By hand', color: 'gray' },
      { value: 'order', label: 'Order', color: 'teal' },
    ]
    expect(appendMissingOptions(stored, wanted)).toEqual([
      { value: 'manual', label: 'By hand', color: 'gray' },
      { value: 'order', label: 'Order', color: 'teal' },
      { value: 'batch', label: 'Batch', color: 'purple' },
    ])
  })

  it('returns null once every wanted option is present, so a re-run writes nothing', () => {
    const stored = wanted.map((option) => ({ ...option }))
    expect(appendMissingOptions(stored, wanted)).toBeNull()
  })

  it('never rewrites a stored value key', () => {
    // `FieldValue.optionId` stores this key on `updatable: false` fields that
    // nothing can restate, so changing one orphans every build carrying it.
    const stored = [{ value: 'manual', label: 'Manual', color: 'gray' }]
    const next = appendMissingOptions(stored, wanted)
    expect(next?.[0]).toBe(stored[0])
  })
})

describe('the two demand-period fields are shaped for netting', () => {
  it('are system DATETIME fields on the two named attributes', () => {
    expect(BUILD_FIELDS.periodStart?.systemAttribute).toBe('build_period_start')
    expect(BUILD_FIELDS.periodEnd?.systemAttribute).toBe('build_period_end')
    for (const field of [BUILD_FIELDS.periodStart, BUILD_FIELDS.periodEnd]) {
      expect(field?.isSystem).toBe(true)
      // DATETIME, not DATE: a bucket boundary is a book-timezone instant, and
      // rounding it to UTC midnight moves demand across the month boundary.
      expect(field?.fieldType).toBe('DATETIME')
    }
  })

  it('are nullable, because a manual or order-raised build claims no period', () => {
    expect(BUILD_FIELDS.periodStart?.nullable).toBe(true)
    expect(BUILD_FIELDS.periodEnd?.nullable).toBe(true)
  })

  it('are set on the insert and never edited afterwards', () => {
    for (const field of [BUILD_FIELDS.periodStart, BUILD_FIELDS.periodEnd]) {
      expect(field?.capabilities.creatable).toBe(true)
      expect(field?.capabilities.updatable).toBe(false)
      // The period is derived from the range and grouping the dialog was given,
      // so it is not a question the create dialog asks.
      expect(field?.showInDialogs).toBe(false)
    }
  })

  it('are filterable, which is what the netting read needs', () => {
    expect(BUILD_FIELDS.periodStart?.capabilities.filterable).toBe(true)
    expect(BUILD_FIELDS.periodEnd?.capabilities.filterable).toBe(true)
  })

  it('do not collide with an existing sort order on the build def', () => {
    const collisions = (key: string) =>
      Object.entries(BUILD_FIELDS).filter(
        ([name, f]) => name !== key && f.systemSortOrder === BUILD_FIELDS[key]?.systemSortOrder
      )
    expect(collisions('periodStart')).toEqual([])
    expect(collisions('periodEnd')).toEqual([])
  })
})
