// packages/lib/src/data-migrations/data-migrations.test.ts

import { describe, expect, it } from 'vitest'
import { assertUniqueMigrationIds, deriveDataMigrationStatuses, planDataMigrations } from './plan'
import { ALL_DATA_MIGRATIONS } from './registry'
import type { DataMigrationDef } from './types'
import { wrapEntityMigration } from './wrap-entity-migration'

/** Build a throwaway registry of bare migration defs for plan/status tests. */
function defs(...ids: string[]): DataMigrationDef[] {
  return ids.map((id) => ({
    id,
    description: `migration ${id}`,
    run: async () => {},
  }))
}

describe('assertUniqueMigrationIds', () => {
  it('passes for unique ids', () => {
    expect(() => assertUniqueMigrationIds(defs('001', '002', '003'))).not.toThrow()
  })

  it('throws on a duplicate id', () => {
    expect(() => assertUniqueMigrationIds(defs('001', '002', '001'))).toThrow(
      /Duplicate data migration id: 001/
    )
  })
})

describe('registry', () => {
  it('has unique ids in ascending order', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(() => assertUniqueMigrationIds(ALL_DATA_MIGRATIONS)).not.toThrow()
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it('includes the carried-over entity migration ids', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('001-vendor-part-subpart')
    expect(ids).toContain('023-contact-visitor-geo-fields')
  })
})

describe('planDataMigrations', () => {
  it('attempts everything when the ledger is empty', () => {
    const registry = defs('001', '002', '003')
    const plan = planDataMigrations(registry, [])
    expect(plan.toAttempt.map((m) => m.id)).toEqual(['001', '002', '003'])
    expect(plan.skipped).toEqual([])
    expect(plan.haltedBy).toBeUndefined()
  })

  it('skips applied migrations and attempts the rest', () => {
    const registry = defs('001', '002', '003')
    const plan = planDataMigrations(registry, [
      { id: '001', status: 'applied' },
      { id: '002', status: 'applied' },
    ])
    expect(plan.skipped).toEqual(['001', '002'])
    expect(plan.toAttempt.map((m) => m.id)).toEqual(['003'])
    expect(plan.haltedBy).toBeUndefined()
  })

  it('fail-stops at a failed row and does not attempt anything after it', () => {
    const registry = defs('001', '002', '003', '004')
    const plan = planDataMigrations(registry, [
      { id: '001', status: 'applied' },
      { id: '002', status: 'failed' },
    ])
    expect(plan.skipped).toEqual(['001'])
    expect(plan.haltedBy).toBe('002')
    // 003 and 004 are blocked — never attempted while 002 is failed.
    expect(plan.toAttempt).toEqual([])
  })

  it('treats a missing row as pending (re-runs after a failed row is cleared)', () => {
    const registry = defs('001', '002', '003')
    const plan = planDataMigrations(registry, [{ id: '001', status: 'applied' }])
    // 002's failed row was deleted by a re-run → now pending and attempted again.
    expect(plan.toAttempt.map((m) => m.id)).toEqual(['002', '003'])
    expect(plan.haltedBy).toBeUndefined()
  })
})

describe('deriveDataMigrationStatuses', () => {
  it('joins the registry with the ledger and defaults missing rows to pending', () => {
    const registry = defs('001', '002', '003')
    const ranAt = new Date('2026-01-01T00:00:00Z')
    const statuses = deriveDataMigrationStatuses(registry, [
      { id: '001', status: 'applied', durationMs: 1200, appliedAt: ranAt, error: null },
      { id: '002', status: 'failed', durationMs: 50, appliedAt: ranAt, error: 'boom' },
    ])

    expect(statuses).toEqual([
      {
        id: '001',
        description: 'migration 001',
        status: 'applied',
        error: null,
        durationMs: 1200,
        appliedAt: ranAt,
      },
      {
        id: '002',
        description: 'migration 002',
        status: 'failed',
        error: 'boom',
        durationMs: 50,
        appliedAt: ranAt,
      },
      {
        id: '003',
        description: 'migration 003',
        status: 'pending',
        error: null,
        durationMs: null,
        appliedAt: null,
      },
    ])
  })
})

describe('wrapEntityMigration', () => {
  it('carries over id and description and exposes a run()', () => {
    const wrapped = wrapEntityMigration({
      id: '042-test',
      description: 'a test entity migration',
      up: async () => ({
        entityDefsCreated: 0,
        fieldsCreated: 0,
        relationshipsLinked: 0,
        alreadyUpToDate: true,
      }),
    })

    expect(wrapped.id).toBe('042-test')
    expect(wrapped.description).toBe('a test entity migration')
    expect(typeof wrapped.run).toBe('function')
  })
})
