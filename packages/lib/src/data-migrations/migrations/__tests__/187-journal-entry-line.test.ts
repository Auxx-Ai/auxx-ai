// packages/lib/src/data-migrations/migrations/__tests__/187-journal-entry-line.test.ts
//
// The `journal_entry_line` child def (91 D5): registered everywhere a hidden def
// has to be, `journal_entry.lines` a cascading has_many, and the migration that
// reaches existing orgs - skip without a journal def, drop a stale JSON `lines`
// field first, link both halves, and fail loudly when a half stays unlinked.

import type { Database } from '@auxx/database'
import { ENTITY_DEFINITION_TYPES } from '@auxx/types/resource'
import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Migration187Result } from '../187-journal-entry-line'

const h = vi.hoisted(() => ({
  existingDefs: [] as string[],
  ensureEntityDefinitions: vi.fn(),
  ensureCustomFields: vi.fn(),
  linkNewRelationships: vi.fn(),
  linkDisplayFields: vi.fn(),
  invalidateAndRecompute: vi.fn(async () => {}),
}))

vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute: h.invalidateAndRecompute }),
}))

vi.mock('../../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      h.existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
  ensureEntityDefinitions: h.ensureEntityDefinitions,
  ensureCustomFields: h.ensureCustomFields,
  linkNewRelationships: h.linkNewRelationships,
  linkDisplayFields: h.linkDisplayFields,
}))

const { migration187JournalEntryLine } = await import('../187-journal-entry-line')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { RESOURCE_FIELD_REGISTRY } = await import('../../../resources/registry/field-registry')
const { JOURNAL_ENTRY_FIELDS } = await import(
  '../../../resources/registry/resources/journal-entry-fields'
)
const { JOURNAL_ENTRY_LINE_FIELDS } = await import(
  '../../../resources/registry/resources/journal-entry-line-fields'
)
const { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } = await import(
  '../../../seed/entity-seeder/constants'
)
const { FIELD_REGISTRY } = await import('../../../seed/entity-seeder/create-fields')

const MIGRATION_ID = '187-journal-entry-line'

/** A database answering the stale-field lookup with `staleType`, and every relationship as linked. */
function fakeDb(staleType: string | null, linked = true) {
  const deletes: string[] = []
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (staleType ? [{ id: 'f_stale', type: staleType }] : []),
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        deletes.push('f_stale')
      },
    }),
    query: {
      CustomField: {
        findFirst: async () => ({
          options: { relationship: { inverseResourceFieldId: linked ? 'def_x:f_y' : undefined } },
        }),
      },
    },
  } as unknown as Database
  return { db, deletes }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.existingDefs = ['journal_entry']
  h.ensureEntityDefinitions.mockImplementation(
    async (_db, _org, _entities, _existing, state: { entityDefsCreated: number }) => {
      state.entityDefsCreated++
      return new Map([['journal_entry_line', 'def_journal_entry_line']])
    }
  )
  h.ensureCustomFields.mockImplementation(
    async (_db, _org, entityType: string, _defId, fields: Record<string, { id: string }>) =>
      new Map(Object.values(fields).map((field) => [`${entityType}:${field.id}`, { id: 'f' }]))
  )
})

describe('migration 187 registration', () => {
  it('is registered exactly once and sorts into the shared registry', () => {
    expect(PER_ORG_MIGRATIONS).toContain(migration187JournalEntryLine)
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(ids.filter((id) => id.startsWith('187-'))).toHaveLength(1)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('journal_entry_line is registered everywhere a hidden def has to be', () => {
  it('is an EntityDefinitionType, so a journal_entry_line:<id> RecordId canonicalizes', () => {
    expect(ENTITY_DEFINITION_TYPES).toContain('journal_entry_line')
  })

  it('resolves the same field map in both registries', () => {
    expect(RESOURCE_FIELD_REGISTRY.journal_entry_line).toBe(JOURNAL_ENTRY_LINE_FIELDS)
    expect(FIELD_REGISTRY.journal_entry_line).toBe(JOURNAL_ENTRY_LINE_FIELDS)
  })

  it('is a hidden SYSTEM_ENTITIES entry', () => {
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'journal_entry_line')
    expect(entity?.apiSlug).toBe('journal-entry-lines')
    expect(entity?.isVisible).toBe(false)
  })

  it('carries shared system attributes with distinct sort orders, and displays as its own fields', () => {
    const orders = Object.values(JOURNAL_ENTRY_LINE_FIELDS).map((f) => f.systemSortOrder)
    for (const field of Object.values(JOURNAL_ENTRY_LINE_FIELDS)) {
      expect(SYSTEM_ATTRIBUTES).toContain(field.systemAttribute)
    }
    expect(new Set(orders).size).toBe(orders.length)
    const config = DISPLAY_FIELD_CONFIG.journal_entry_line!
    expect(JOURNAL_ENTRY_LINE_FIELDS[config.primaryDisplayField]).toBeDefined()
    expect(JOURNAL_ENTRY_LINE_FIELDS[config.secondaryDisplayField!]).toBeDefined()
  })

  it('names its account as a TEXT gl_account id, like vendor_bill_line', () => {
    expect(JOURNAL_ENTRY_LINE_FIELDS.glAccount?.systemAttribute).toBe(
      'journal_entry_line_gl_account'
    )
    expect(JOURNAL_ENTRY_LINE_FIELDS.glAccount?.fieldType).toBe('TEXT')
  })
})

describe('the journal_entry:lines edge', () => {
  it('cascades from the entry to its lines, and the line points back with no onDelete', () => {
    expect(JOURNAL_ENTRY_FIELDS.lines?.relationship).toMatchObject({
      inverseResourceFieldId: 'journal_entry_line:journalEntry',
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    })
    expect(JOURNAL_ENTRY_LINE_FIELDS.journalEntry?.relationship).toMatchObject({
      inverseResourceFieldId: 'journal_entry:lines',
      relationshipType: 'belongs_to',
    })
    expect(JOURNAL_ENTRY_LINE_FIELDS.journalEntry?.relationship?.onDelete).toBeUndefined()
  })
})

describe('migration187JournalEntryLine.up', () => {
  it('skips an org with no journal_entry def', async () => {
    h.existingDefs = []
    const { db } = fakeDb(null)
    const result = await migration187JournalEntryLine.up(db, 'org_1')
    expect(result.alreadyUpToDate).toBe(true)
    expect(h.ensureEntityDefinitions).not.toHaveBeenCalled()
  })

  it('creates the def and both halves of the edge, and drops the org caches', async () => {
    const { db, deletes } = fakeDb(null)
    const result = await migration187JournalEntryLine.up(db, 'org_1')

    expect(deletes).toEqual([])
    expect(h.ensureEntityDefinitions.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ entityType: 'journal_entry_line' }),
    ])
    expect(h.ensureCustomFields).toHaveBeenCalledWith(
      db,
      'org_1',
      'journal_entry',
      'def_journal_entry',
      { lines: JOURNAL_ENTRY_FIELDS.lines },
      expect.anything(),
      expect.anything()
    )
    expect(h.linkNewRelationships).toHaveBeenCalled()
    expect(h.linkDisplayFields).toHaveBeenCalledWith(
      db,
      ['journal_entry_line'],
      expect.any(Map),
      expect.any(Map)
    )
    expect(result.alreadyUpToDate).toBe(false)
    expect(h.invalidateAndRecompute).toHaveBeenCalled()
  })

  it('drops a stale JSON journal_entry_lines field before recreating it', async () => {
    const { db, deletes } = fakeDb('JSON')
    const result = (await migration187JournalEntryLine.up(db, 'org_1')) as Migration187Result
    expect(deletes).toEqual(['f_stale'])
    expect(result.staleLinesFieldDropped).toBe(true)
  })

  it('leaves a RELATIONSHIP journal_entry_lines alone on a re-run', async () => {
    const { db, deletes } = fakeDb('RELATIONSHIP')
    await migration187JournalEntryLine.up(db, 'org_1')
    expect(deletes).toEqual([])
  })

  it('fails loudly when a half of the edge stays unlinked', async () => {
    const { db } = fakeDb(null, false)
    await expect(migration187JournalEntryLine.up(db, 'org_1')).rejects.toThrow(/could not link/)
  })
})
