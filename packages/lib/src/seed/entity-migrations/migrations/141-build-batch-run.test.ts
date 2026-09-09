// packages/lib/src/seed/entity-migrations/migrations/141-build-batch-run.test.ts
//
// Migration 141 adds a single `CustomField` row, so what can silently go wrong
// is the wiring rather than the write:
//
//  - the id must be unique across a space shared with `data-migrations/`, which
//    has already collided once at 103;
//  - it must run after 109, which creates the `build` def it widens;
//  - the registry key it names must exist, or it quietly creates nothing while
//    reporting success;
//  - the field's shape is what the run number depends on: a filter is how
//    "show me run 2" is answered, and `updatable: false` is what keeps a run's
//    membership from being edited out from under an undo.

import { describe, expect, it } from 'vitest'
import { BUILD_FIELDS } from '../../../resources/registry/resources/build-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration141BuildBatchRun } from './141-build-batch-run'

const MIGRATION_ID = '141-build-batch-run'

describe('migration 141 registration', () => {
  it('is registered exactly once, with a unique id, after 109', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('109-build-and-standard-cost'))
    expect(migration141BuildBatchRun.id).toBe(MIGRATION_ID)
  })

  it('sorts after 140, which took the id the brief named', () => {
    // 45 §5 asked for "a migration 140". `140-integrations-view` landed first,
    // so this is 141 and must still be the last entry.
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('140-integrations-view'))
  })
})

describe('the batch run field is shaped for filtering and undo', () => {
  it('is a system NUMBER field on the named attribute', () => {
    expect(BUILD_FIELDS.batchRun?.systemAttribute).toBe('build_batch_run')
    expect(BUILD_FIELDS.batchRun?.isSystem).toBe(true)
    expect(BUILD_FIELDS.batchRun?.fieldType).toBe('NUMBER')
  })

  it('is nullable, because a manual or order-raised build belongs to no run', () => {
    expect(BUILD_FIELDS.batchRun?.nullable).toBe(true)
  })

  it('is set on the insert and never edited afterwards', () => {
    expect(BUILD_FIELDS.batchRun?.capabilities.creatable).toBe(true)
    expect(BUILD_FIELDS.batchRun?.capabilities.updatable).toBe(false)
    // The number is allocated once per run and passed down, so it is not a
    // question the create dialog asks.
    expect(BUILD_FIELDS.batchRun?.showInDialogs).toBe(false)
  })

  it('is filterable, which is how "show me run 2" is answered', () => {
    expect(BUILD_FIELDS.batchRun?.capabilities.filterable).toBe(true)
  })

  it('does not collide with an existing sort order on the build def', () => {
    const collisions = Object.entries(BUILD_FIELDS).filter(
      ([name, f]) =>
        name !== 'batchRun' && f.systemSortOrder === BUILD_FIELDS.batchRun?.systemSortOrder
    )
    expect(collisions).toEqual([])
  })
})
