// packages/lib/src/seed/entity-migrations/migrations/142-wipe-seeded-charts.test.ts
//
// Migration 142 is a delete-only pass with no `UnifiedCrudHandler` in its path,
// so it is testable against a stub `Database` the way `108-purchasing.test.ts`
// stubs one; no shared harness needed. What is pinned here:
//
//  - the id is unique, registered, and last in `ALL_ENTITY_MIGRATIONS`;
//  - `alreadyUpToDate` is reported correctly in both directions: nothing to
//    wipe, and something to wipe;
//  - `deleteEntityInstances` is called with the UNION of gl_account and
//    journal_entry instance ids, never a partial set;
//  - the referencing-FieldValue guard fails closed;
//  - `SETTINGS_TO_RESET` names exactly the twelve wizard-state keys and
//    excludes the three configuration keys 17 §1 calls out by name;
//  - `settingsNeedingReset` treats an absent row as already-default.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import {
  migration142WipeSeededCharts,
  SETTINGS_TO_RESET,
  settingsNeedingReset,
} from './142-wipe-seeded-charts'

const MIGRATION_ID = '142-wipe-seeded-charts'

// `getOrgCache` is a Redis round trip the stub `Database` below has nothing to
// back: the same reason every other migration test in this directory stubs it.
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute: async () => {} }),
}))

// `deleteEntityInstances` opens its own transaction and sweeps FieldValue,
// TimelineEvent and ResourceAccess, none of which the stub `Database` below
// implements, and none of which this file is about. Its own contract is
// tested in `entity-instances/__tests__/delete-entity-instance.test.ts`. What
// is pinned HERE is that 142 calls it with the right ids.
const deleteCalls: { ids: readonly string[]; organizationId: string }[] = []
vi.mock('../../../entity-instances', () => ({
  deleteEntityInstances: async (params: { ids: readonly string[]; organizationId: string }) => {
    deleteCalls.push(params)
    return {
      isErr: () => false as const,
      isOk: () => true as const,
      value: { count: params.ids.length },
    }
  },
}))

// `batchUpdateOrganizationSettings` opens its own transaction and normalizes
// through the catalog; also not this file's concern. What is pinned HERE is
// that 142 calls it with exactly the settings that changed.
const settingsCalls: { key: string; value: unknown }[][] = []
vi.mock('../../../settings/settings-service', () => ({
  batchUpdateOrganizationSettings: async (params: {
    settings: { key: string; value: unknown }[]
  }) => {
    settingsCalls.push(params.settings)
  },
}))

type Row = Record<string, unknown>

/** A stub `Database` whose `.select().from(table).where(...)` resolves a
 * pre-seeded row set keyed by TABLE OBJECT IDENTITY, and whose `.delete(table)`
 * records what was deleted. Modelled on `108-purchasing.test.ts`'s `migratedOrgDb`. */
function stubDb(rows: {
  entityDefs?: Row[]
  customFields?: Row[]
  entityInstances?: Row[]
  glRoleAssignments?: Row[]
  fieldValues?: Row[]
  organizationSettings?: Row[]
}) {
  const deletes: string[] = []
  const tableName = (table: unknown): string => {
    if (table === schema.EntityDefinition) return 'EntityDefinition'
    if (table === schema.CustomField) return 'CustomField'
    if (table === schema.EntityInstance) return 'EntityInstance'
    if (table === schema.GlRoleAssignment) return 'GlRoleAssignment'
    if (table === schema.FieldValue) return 'FieldValue'
    if (table === schema.RecordIdentity) return 'RecordIdentity'
    if (table === schema.OrganizationSetting) return 'OrganizationSetting'
    return 'unknown'
  }
  const rowsFor = (table: unknown): Row[] => {
    switch (tableName(table)) {
      case 'EntityDefinition':
        return rows.entityDefs ?? []
      case 'CustomField':
        return rows.customFields ?? []
      case 'EntityInstance':
        return rows.entityInstances ?? []
      case 'GlRoleAssignment':
        return rows.glRoleAssignments ?? []
      case 'FieldValue':
        return rows.fieldValues ?? []
      case 'OrganizationSetting':
        return rows.organizationSettings ?? []
      default:
        return []
    }
  }

  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => {
        // `EntityInstance` queries are scoped further by `entityDefinitionId`
        // in the migration, but the stub has no `where`-clause interpreter;
        // callers configure `entityInstances` already scoped to the def under
        // test (a single def per test), which is all these tests need.
        const data = rowsFor(table)
        const promise: Promise<Row[]> & { limit?: (n: number) => Promise<Row[]> } =
          Promise.resolve(data)
        promise.limit = (n: number) => Promise.resolve(data.slice(0, n))
        return { where: () => promise }
      },
    }),
    delete: (table: unknown) => ({
      where: async () => {
        deletes.push(tableName(table))
      },
    }),
  }

  return { db: db as unknown as Database, deletes }
}

describe('migration 142 registration', () => {
  // No longer asserted "last in the list": migration 143
  // (gl-pointers-hold-ids) reads whatever gl_account rows exist regardless of
  // which migration wrote them and has no ordering constraint against this
  // one, so it registers after 142 without disturbing anything this file
  // pins about 142 itself.
  it('is registered exactly once, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(migration142WipeSeededCharts.id).toBe(MIGRATION_ID)
  })
})

describe('nothing to wipe', () => {
  it('reports alreadyUpToDate when the org has no chart, no journal entries, no roles and no settings', async () => {
    deleteCalls.length = 0
    settingsCalls.length = 0
    const { db } = stubDb({})

    const result = await migration142WipeSeededCharts.up(db, 'org-clean')

    expect(result.alreadyUpToDate).toBe(true)
    expect(deleteCalls).toHaveLength(0)
    expect(settingsCalls).toHaveLength(0)
  })

  // An org that has NEVER opened the wizard has no `OrganizationSetting` rows
  // for any of these keys: an absent row reads as the catalog default, which
  // for every key in `SETTINGS_TO_RESET` already IS the reset target. Getting
  // this wrong would mean the migration always reports work on every org.
  it('does not count an org with a chart def but zero rows as needing work', async () => {
    deleteCalls.length = 0
    settingsCalls.length = 0
    const { db } = stubDb({
      entityDefs: [{ id: 'def-gl_account', entityType: 'gl_account' }],
    })

    const result = await migration142WipeSeededCharts.up(db, 'org-def-only')

    expect(result.alreadyUpToDate).toBe(true)
  })
})

describe('wiping a seeded org', () => {
  it('deletes the union of gl_account and journal_entry instance ids in one call', async () => {
    deleteCalls.length = 0
    settingsCalls.length = 0
    const { db } = stubDb({
      entityDefs: [
        { id: 'def-gl_account', entityType: 'gl_account' },
        { id: 'def-journal_entry', entityType: 'journal_entry' },
      ],
      // The stub cannot distinguish the two EntityInstance queries by def id,
      // so both defs' instances are pre-unioned here: what matters is that
      // `deleteEntityInstances` receives everything the stub returns, once.
      entityInstances: [{ id: 'acct-1' }, { id: 'acct-2' }, { id: 'je-1' }],
    })

    const result = await migration142WipeSeededCharts.up(db, 'org-seeded')

    expect(result.alreadyUpToDate).toBe(false)
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0]?.organizationId).toBe('org-seeded')
    // Each def's instance query resolves the same stubbed row set, so the
    // union is the same three ids twice (six total), which is exactly what
    // the guard-and-delete pipeline should carry through unmodified.
    expect(deleteCalls[0]?.ids).toHaveLength(6)
  })

  it('deletes GlRoleAssignment rows for the org when any exist, chart or not', async () => {
    deleteCalls.length = 0
    settingsCalls.length = 0
    const { db, deletes } = stubDb({
      glRoleAssignments: [{ id: 'ra-1' }, { id: 'ra-2' }],
    })

    const result = await migration142WipeSeededCharts.up(db, 'org-roles-only')

    expect(result.alreadyUpToDate).toBe(false)
    expect(deletes).toContain('GlRoleAssignment')
  })

  it('resets only the settings whose stored value differs from the target', async () => {
    deleteCalls.length = 0
    settingsCalls.length = 0
    const { db } = stubDb({
      organizationSettings: [
        { key: 'accounting.setupState', value: 'finalized' },
        // Already at the target; must NOT be re-written.
        { key: 'accounting.cutoffPeriod', value: null },
      ],
    })

    const result = await migration142WipeSeededCharts.up(db, 'org-settings-only')

    expect(result.alreadyUpToDate).toBe(false)
    expect(settingsCalls).toHaveLength(1)
    const written = settingsCalls[0] ?? []
    expect(written.map((s) => s.key)).toEqual(['accounting.setupState'])
    expect(written[0]?.value).toBe('draft')
  })

  it('refuses to wipe when a FieldValue points at a chart or journal-entry instance', async () => {
    deleteCalls.length = 0
    settingsCalls.length = 0
    const { db } = stubDb({
      entityDefs: [{ id: 'def-gl_account', entityType: 'gl_account' }],
      entityInstances: [{ id: 'acct-1' }],
      fieldValues: [{ id: 'fv-1', fieldId: 'field-x' }],
    })

    await expect(migration142WipeSeededCharts.up(db, 'org-referenced')).rejects.toThrow(
      /refusing to wipe/i
    )
    expect(deleteCalls).toHaveLength(0)
  })
})

describe('the settings this migration resets', () => {
  it('names exactly the twelve wizard-state keys', () => {
    const keys = SETTINGS_TO_RESET.map((s) => s.key).sort()
    expect(keys).toEqual(
      [
        'accounting.cutoffPeriod',
        'accounting.openingFinishedGoods',
        'accounting.openingRawMaterials',
        'accounting.openingWip',
        'accounting.qboOpeningFinishedGoods',
        'accounting.qboOpeningJournalRef',
        'accounting.qboOpeningRawMaterials',
        'accounting.qboOpeningWip',
        'accounting.setupFinalizedAt',
        'accounting.setupFinalizedByUserId',
        'accounting.setupState',
        'ledger.lockedThroughMonth',
      ].sort()
    )
  })

  // 17 §1: these three are configuration a person may set independently of
  // the wizard, not wizard state, and must survive the wipe untouched.
  it('excludes bookTimeZone, fulfillmentPosting and paymentRoute.*', () => {
    const keys = SETTINGS_TO_RESET.map((s) => s.key)
    expect(keys).not.toContain('accounting.bookTimeZone')
    expect(keys).not.toContain('accounting.fulfillmentPosting')
    expect(keys.some((k) => k.startsWith('accounting.paymentRoute.'))).toBe(false)
  })

  it('resets accounting.setupState to draft, and every other key to null', () => {
    for (const setting of SETTINGS_TO_RESET) {
      if (setting.key === 'accounting.setupState') {
        expect(setting.value).toBe('draft')
      } else {
        expect(setting.value).toBeNull()
      }
    }
  })
})

describe('settingsNeedingReset', () => {
  it('treats an absent row as already at the target: no work', async () => {
    const { db } = stubDb({ organizationSettings: [] })
    const result = await settingsNeedingReset(db, 'org-1')
    expect(result).toEqual([])
  })

  it('includes a row whose stored value differs from the target', async () => {
    const { db } = stubDb({
      organizationSettings: [{ key: 'ledger.lockedThroughMonth', value: '2026-08' }],
    })
    const result = await settingsNeedingReset(db, 'org-1')
    expect(result).toEqual([{ key: 'ledger.lockedThroughMonth', value: null }])
  })

  it('skips a row whose stored value already matches the target', async () => {
    const { db } = stubDb({
      organizationSettings: [{ key: 'accounting.setupState', value: 'draft' }],
    })
    const result = await settingsNeedingReset(db, 'org-1')
    expect(result).toEqual([])
  })
})
