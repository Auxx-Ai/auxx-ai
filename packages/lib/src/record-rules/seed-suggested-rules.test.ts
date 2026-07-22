// packages/lib/src/record-rules/seed-suggested-rules.test.ts
// Covers idempotency (a second run inserts nothing once all 3 templates exist) and that the
// hot-contact-follow-up template's persisted shape passes `assertRuleShape` (the same
// validator the tRPC create/update path runs) — see plans/signals/06-follow-ups-build.md
// Step 6. Schema is a Proxy (Drizzle-columns-undefined-under-vitest gotcha — project memory);
// drizzle-orm's `and`/`eq` are stubbed so the real query builder never runs against the fake
// columns.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const schemaHandler: ProxyHandler<any> = {
    get(_target, tableProp) {
      return new Proxy(
        {},
        {
          get(_t, colProp) {
            return `${String(tableProp)}.${String(colProp)}`
          },
        }
      )
    },
  }
  return {
    mockSchema: new Proxy({}, schemaHandler),
    and: vi.fn((...conds: any[]) => ({ type: 'and', conds })),
    eq: vi.fn((col: any, val: any) => ({ type: 'eq', col, val })),
    findFirst: vi.fn(),
    insertValues: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('drizzle-orm', () => ({ and: h.and, eq: h.eq }))
vi.mock('@auxx/database', () => ({ schema: h.mockSchema }))

import { SUGGESTED_RECORD_RULE_TEMPLATES, seedSuggestedRecordRules } from './seed-suggested-rules'
import { assertRuleShape } from './store'

/** Fake `Database` — one `.select().from().where().limit()` chain (contact def lookup),
 * `.query.RecordRule.findFirst` (existing-template check), and `.insert().values()`. */
function makeDb(contactDefRows: Array<{ id: string }>) {
  const limit = vi.fn().mockResolvedValue(contactDefRows)
  const where = vi.fn().mockReturnValue({ limit })
  const from = vi.fn().mockReturnValue({ where })
  const select = vi.fn().mockReturnValue({ from })
  const values = h.insertValues
  const insert = vi.fn().mockReturnValue({ values })
  return {
    select,
    insert,
    query: { RecordRule: { findFirst: h.findFirst } },
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.insertValues.mockResolvedValue(undefined)
})

describe('seedSuggestedRecordRules', () => {
  it('no-ops when the contact entity def is not ready yet', async () => {
    const db = makeDb([])
    await seedSuggestedRecordRules(db, 'org_1')
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('creates all 3 templates when none exist yet', async () => {
    const db = makeDb([{ id: 'def_contact' }])
    h.findFirst.mockResolvedValue(undefined)

    await seedSuggestedRecordRules(db, 'org_1')

    expect(db.insert).toHaveBeenCalledTimes(SUGGESTED_RECORD_RULE_TEMPLATES.length)
    const insertedTemplateKeys = h.insertValues.mock.calls.map((call) => call[0].templateKey)
    expect(insertedTemplateKeys).toEqual(SUGGESTED_RECORD_RULE_TEMPLATES.map((t) => t.templateKey))
    for (const call of h.insertValues.mock.calls) {
      const row = call[0]
      expect(row.entityDefinitionId).toBe('def_contact')
      expect(row.on).toBe('signal')
      expect(row.enabled).toBe(false)
      expect(row.fieldId).toBeNull()
    }
  })

  it('is idempotent — a second run (all templates already present) inserts nothing', async () => {
    const db = makeDb([{ id: 'def_contact' }])
    h.findFirst.mockResolvedValue({ id: 'existing_rule' })

    await seedSuggestedRecordRules(db, 'org_1')

    expect(db.insert).not.toHaveBeenCalled()
  })

  it("the hot-contact-follow-up template's shape passes assertRuleShape", () => {
    const template = SUGGESTED_RECORD_RULE_TEMPLATES.find(
      (t) => t.templateKey === 'suggested:hot-contact-follow-up'
    )
    expect(template).toBeDefined()
    expect(() =>
      assertRuleShape({
        fieldId: null,
        on: 'signal',
        signalKind: template!.signalKind,
        actions: template!.actions,
        condition: template!.condition,
      })
    ).not.toThrow()
  })

  it("every suggested template's shape passes assertRuleShape", () => {
    for (const template of SUGGESTED_RECORD_RULE_TEMPLATES) {
      expect(() =>
        assertRuleShape({
          fieldId: null,
          on: 'signal',
          signalKind: template.signalKind,
          actions: template.actions,
          condition: template.condition,
        })
      ).not.toThrow()
    }
  })
})
