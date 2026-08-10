// packages/lib/src/mail-filters/seed-suggested-filters.test.ts
// Phase 5's seeded suggestions. Five things are load-bearing and all five are pinned here:
//
//  1. **Idempotency on `templateKey`** — a second pass must insert nothing, so a customer's
//     edits to a seeded filter are never overwritten.
//  2. **Seeded disabled** — a suggestion must not start mutating mail on day one (D18).
//  3. **Every template survives `assertFilterShape`** — the same validator the tRPC
//     create/update path runs.
//  4. **Every condition's `fieldId` is one `condition-query-builder.ts` actually
//     dispatches** — read out of that file's source, not copied from it. A `fieldId` the
//     builder cannot dispatch is DROPPED silently, which WIDENS the filter (it matches more
//     mail, and the rows it then archives are not the ones the author asked for). Same for
//     the operator: a field builder that declines it drops the clause the same way.
//  5. **Seeded rows never consume the plan allowance** — the row always carries a
//     `templateKey`, and `countBillableMailFilters` excludes `templateKey IS NOT NULL`.
//  5b. **The deterministic replacement for the retired `Newsletter`/`Notification` AI
//     labels stays deterministic** (categories plan 06 D2) — a header-keyed filter, no
//     tag dependency, and never an ARCHIVE on the broad "any mailing list" signal.
//  6. **The `mailFilters` org-cache key is busted after a seed that actually inserted** —
//     and only then. The cached array is what the gate reads; leaving it stale is invisible
//     while seeds are disabled and becomes a real bug the moment one is enabled.
//
// Partial mocks only (the lib-test collection rule — a full replacement of `@auxx/database`
// / `drizzle-orm` dies at COLLECTION time as the import graph grows). `sql` stays REAL so
// the `order` subquery is exercised rather than stubbed away.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChainableDatabaseMock, createSchemaMock } from '../test/database-mock'

/** Printable column tokens for the one table this file asserts a predicate on. */
const h = vi.hoisted(() => ({
  mailFilterColumns: new Proxy(
    {},
    { get: (_t, col) => (typeof col === 'string' ? `MailFilter.${col}` : undefined) }
  ),
  onCacheEvent: vi.fn(),
}))

// The seed writes rows the `mailFilters` org-cache key holds an array of, so it
// has to bust that key — otherwise the cached array is stale until TTL, which
// stops being harmless the moment anything enables a seeded filter.
vi.mock('../cache', () => ({ onCacheEvent: h.onCacheEvent }))

vi.mock('@auxx/database', () => ({
  database: createChainableDatabaseMock(),
  // Auto-vivifies every other table (the collection-time rule); `MailFilter` is pinned so
  // the `countBillableMailFilters` predicate is readable.
  schema: createSchemaMock({ MailFilter: h.mailFilterColumns }),
}))

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  eq: (col: unknown, value: unknown) => ({ eq: [col, value] }),
  ne: (col: unknown, value: unknown) => ({ ne: [col, value] }),
  isNull: (col: unknown) => ({ isNull: col }),
  inArray: (col: unknown, values: unknown) => ({ inArray: [col, values] }),
  asc: (col: unknown) => ({ asc: col }),
  count: () => ({ count: true }),
}))

import type { ConditionGroup } from '../conditions/types'
import { assertFilterConditionsCompile } from './evaluate'
import { countBillableMailFilters } from './limits'
import { assertFilterShape } from './mutations'
import { SUGGESTED_MAIL_FILTER_TEMPLATES, seedSuggestedMailFilters } from './seed-suggested-filters'

// ───────────────────────────────────────────────────────────────────────────
// The builder's real dispatch table, read out of its source
// ───────────────────────────────────────────────────────────────────────────

const BUILDER_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../mail-query/condition-query-builder.ts'),
  'utf8'
)

/** Every `case '<label>':` inside one named function in the builder's source. */
function caseLabelsOf(fnName: string): Set<string> {
  const start = BUILDER_SOURCE.indexOf(`function ${fnName}(`)
  if (start === -1) throw new Error(`${fnName} not found in condition-query-builder.ts`)
  const end = BUILDER_SOURCE.indexOf('\n}\n', start)
  const body = BUILDER_SOURCE.slice(start, end === -1 ? undefined : end)
  return new Set([...body.matchAll(/case '([^']+)':/g)].map((m) => m[1] as string))
}

/** `fieldId` → the field builder `dispatchConditionQuery` routes it to. */
const FIELD_BUILDERS: Record<string, string> = {
  // `buildFromQuery` is a one-line delegation to `buildSenderQuery`, which owns the cases.
  from: 'buildSenderQuery',
  subject: 'buildSubjectQuery',
  // `buildListQuery` is likewise a one-line delegation — the operator cases live in the
  // shared `buildMessageTextColumnQuery` it hands `Message.listId` to.
  list: 'buildMessageTextColumnQuery',
}

// ───────────────────────────────────────────────────────────────────────────
// Fake database
// ───────────────────────────────────────────────────────────────────────────

interface FakeDb {
  db: never
  inserted: Record<string, unknown>[]
  wheres: unknown[]
}

/**
 * One chainable builder that resolves the next queued result set per `await`.
 *
 * `seedSuggestedMailFilters` awaits, in order: the shared-inbox lookup, the tag lookup,
 * then one existing-row lookup per template.
 */
function makeDb(results: unknown[][]): FakeDb {
  const queue = [...results]
  const inserted: Record<string, unknown>[] = []
  const wheres: unknown[] = []
  // A Proxy rather than an object literal: every builder method returns the chain, and the
  // chain itself is the thenable that yields the next queued result set.
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(queue.shift() ?? []).then(resolve, reject)
        }
        if (prop === 'where') {
          return (cond: unknown) => {
            wheres.push(cond)
            return chain
          }
        }
        return () => chain
      },
    }
  )
  const db = {
    select: () => chain,
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row)
      },
    }),
  }
  return { db: db as never, inserted, wheres }
}

const SHARED_INBOX = [{ id: 'inbox_shared' }]
const TAGS = [
  { id: 'tag_billing', displayName: 'Billing' },
  { id: 'tag_vip', displayName: 'VIP' },
]

/** Result queue for a run where every template is new. */
function freshRun(inbox = SHARED_INBOX, tags = TAGS): unknown[][] {
  return [inbox, tags, ...SUGGESTED_MAIL_FILTER_TEMPLATES.map(() => [])]
}

// ───────────────────────────────────────────────────────────────────────────

describe('SUGGESTED_MAIL_FILTER_TEMPLATES', () => {
  it('is a non-empty catalog of `suggested:`-keyed templates with unique keys', () => {
    expect(SUGGESTED_MAIL_FILTER_TEMPLATES.length).toBeGreaterThan(0)
    const keys = SUGGESTED_MAIL_FILTER_TEMPLATES.map((t) => t.templateKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key.startsWith('suggested:')).toBe(true)
  })

  it('every template passes assertFilterShape', () => {
    for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
      expect(() =>
        assertFilterShape({ name: template.name, actions: template.buildActions('tag_test') })
      ).not.toThrow()
    }
  })

  it('never seeds run-agent / run-workflow (invariant 15 — those need automationRules.manage)', () => {
    for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
      for (const action of template.buildActions('tag_test')) {
        expect(['set-status', 'add-tag', 'suppress-automations']).toContain(action.type)
      }
    }
  })

  it('only ever writes a reversible status — never TRASH or SPAM', () => {
    for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
      for (const action of template.buildActions('tag_test')) {
        if (action.type === 'set-status') expect(action.status).toBe('ARCHIVED')
      }
    }
  })

  it("every condition's fieldId is one the query builder actually dispatches", () => {
    const dispatched = [...caseLabelsOf('dispatchConditionQuery')]
    // Guard the extraction itself — an empty list would make every assertion below vacuous.
    expect(dispatched.length).toBeGreaterThan(5)

    for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
      for (const group of template.conditions) {
        for (const condition of group.conditions) {
          expect(dispatched, `${template.templateKey} / ${String(condition.fieldId)}`).toContain(
            String(condition.fieldId)
          )
        }
      }
    }
  })

  // ── categories plan 06 D2 / §2.4 ──
  // `Newsletter` and `Notification` are retired as AI labels because both are
  // answerable from a header. What replaces them has to actually be a header rule.
  describe('the deterministic replacement for the retired Newsletter/Notification labels', () => {
    const listConditionsOf = (templateKey: string) =>
      SUGGESTED_MAIL_FILTER_TEMPLATES.find((t) => t.templateKey === templateKey)
        ?.conditions.flatMap((g) => g.conditions)
        .filter((c) => String(c.fieldId) === 'list') ?? []

    it('ships a filter keyed on the List-Id signal, not on an AI label', () => {
      const template = SUGGESTED_MAIL_FILTER_TEMPLATES.find(
        (t) => t.templateKey === 'suggested:mailing-list-mail'
      )
      expect(template).toBeDefined()
      expect(listConditionsOf('suggested:mailing-list-mail').map((c) => c.operator)).toEqual([
        'not empty',
      ])
      // No tag: the replacement must not depend on a tag name resolving at seed time,
      // or a taxonomy rename silently skips it (§5.2 — resolution is name-based and
      // logs-and-skips, so the failure is soft but invisible).
      expect(template?.requiredTagName).toBeUndefined()
    })

    it('writes no thread state on the broad signal — `soft` cannot tell a blast from a receipt', () => {
      // §1.1's warning triangle: List-Id (and the `soft` tier it feeds) covers bulk
      // marketing AND transactional notices in one bucket. "Skip the AI" is true of
      // both; "archive it" is not.
      const actions = SUGGESTED_MAIL_FILTER_TEMPLATES.find(
        (t) => t.templateKey === 'suggested:mailing-list-mail'
      )?.buildActions('tag_test')
      expect(actions).toEqual([{ type: 'suppress-automations' }])
    })

    it('never archives on a bare `list not empty` — that is every mailing list in the mailbox', () => {
      for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
        const archives = template
          .buildActions('tag_test')
          .some((a) => a.type === 'set-status' || a.type === 'add-tag')
        if (!archives) continue
        for (const condition of listConditionsOf(template.templateKey)) {
          expect(
            condition.operator,
            `${template.templateKey} archives/tags on an unqualified mailing-list match`
          ).not.toBe('not empty')
        }
      }
    })

    it('matches bulk mail on the list identity too, not only on a from-address fragment', () => {
      // A campaign sender rotates its from-address (VERP) far more often than it
      // renames its list, so `from contains 'newsletter@'` alone misses most blasts.
      expect(listConditionsOf('suggested:bulk-newsletters').length).toBeGreaterThan(0)
      for (const condition of listConditionsOf('suggested:bulk-newsletters')) {
        expect(condition.operator).toBe('contains')
        expect(String(condition.value)).not.toBe('')
      }
    })

    it('keeps every condition id unique within its template', () => {
      // The widened OR group is where a copy-pasted `c4` would collide; duplicate
      // ids make the condition editor edit the wrong row.
      for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
        const ids = template.conditions.flatMap((g) => g.conditions.map((c) => c.id))
        expect(new Set(ids).size, template.templateKey).toBe(ids.length)
      }
    })
  })

  // The source-derived checks above catch a fieldId/operator the builder has no case
  // for. This runs the REAL save-time gate over the same catalog, which additionally
  // catches a value the field builder declines (`in` with an empty array, say) and a
  // builder that throws. Both fail the same way: the condition is dropped, the filter
  // reduces to the bare org scope, and it matches every thread in the inbox
  // (invariant 19).
  describe('every seeded condition set survives assertFilterConditionsCompile', () => {
    /** `Body starts with` — the exact combination invariant 19 is named after. */
    const UNCOMPILABLE: ConditionGroup[] = [
      {
        id: 'g1',
        logicalOperator: 'AND',
        conditions: [
          { id: 'c1', fieldId: 'body', operator: 'starts with' as never, value: 'unsubscribe' },
        ],
      },
    ]

    /** The same, on the `list` field the D2 templates use — a numeric op it declines. */
    const UNCOMPILABLE_LIST: ConditionGroup[] = [
      {
        id: 'g1',
        logicalOperator: 'AND',
        conditions: [{ id: 'c1', fieldId: 'list', operator: '>' as never, value: 'x' }],
      },
    ]

    it('rejects a known-uncompilable set — proving the assertion below is not vacuous', () => {
      expect(() => assertFilterConditionsCompile(UNCOMPILABLE, 'org_1')).toThrow()
      // Pinned on `list` too: the D2 templates are the only ones on that field, and a
      // gate that reported "compiles" for everything reaching `buildListQuery` would
      // pass them vacuously.
      expect(() => assertFilterConditionsCompile(UNCOMPILABLE_LIST, 'org_1')).toThrow()
    })

    it('accepts every template in the catalog', () => {
      for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
        expect(
          () => assertFilterConditionsCompile(template.conditions, 'org_1'),
          template.templateKey
        ).not.toThrow()
      }
    })
  })

  it("every condition's operator is one its field builder accepts", () => {
    for (const template of SUGGESTED_MAIL_FILTER_TEMPLATES) {
      for (const group of template.conditions) {
        for (const condition of group.conditions) {
          const builder = FIELD_BUILDERS[String(condition.fieldId)]
          if (!builder) {
            throw new Error(`no field builder mapped for '${String(condition.fieldId)}'`)
          }
          expect(
            [...caseLabelsOf(builder)],
            `${template.templateKey} / ${condition.operator}`
          ).toContain(condition.operator)
        }
      }
    }
  })
})

beforeEach(() => {
  h.onCacheEvent.mockReset()
  h.onCacheEvent.mockResolvedValue(undefined)
})

describe('seedSuggestedMailFilters', () => {
  it('seeds every template on the default shared inbox, disabled and non-blocking', async () => {
    const { db, inserted } = makeDb(freshRun())

    await seedSuggestedMailFilters(db, 'org_1')

    expect(inserted).toHaveLength(SUGGESTED_MAIL_FILTER_TEMPLATES.length)
    expect(inserted.map((row) => row.templateKey)).toEqual(
      SUGGESTED_MAIL_FILTER_TEMPLATES.map((t) => t.templateKey)
    )
    for (const row of inserted) {
      expect(row.organizationId).toBe('org_1')
      expect(row.inboxId).toBe('inbox_shared')
      // D18 — nothing starts mutating a customer's mail without a click.
      expect(row.enabled).toBe(false)
      expect(row.stopProcessing).toBe(false)
      expect(row.createdByUserId).toBeNull()
    }
  })

  it('is idempotent — a second run (every template already present) inserts nothing', async () => {
    const { db, inserted } = makeDb([
      SHARED_INBOX,
      TAGS,
      ...SUGGESTED_MAIL_FILTER_TEMPLATES.map(() => [{ id: 'existing_filter' }]),
    ])

    await seedSuggestedMailFilters(db, 'org_1')

    expect(inserted).toHaveLength(0)
  })

  it('never overwrites an edited seeded filter — the existing row is left untouched', async () => {
    // One template already exists (the user has since edited and enabled it); the rest are
    // new. The existing one must neither be re-inserted nor updated.
    const { db, inserted } = makeDb([
      SHARED_INBOX,
      TAGS,
      [{ id: 'edited_filter' }],
      ...SUGGESTED_MAIL_FILTER_TEMPLATES.slice(1).map(() => []),
    ])

    await seedSuggestedMailFilters(db, 'org_1')

    expect(inserted.map((row) => row.templateKey)).toEqual(
      SUGGESTED_MAIL_FILTER_TEMPLATES.slice(1).map((t) => t.templateKey)
    )
  })

  it('no-ops (without throwing) when the org has no shared inbox yet', async () => {
    const { db, inserted } = makeDb([[]])

    await expect(seedSuggestedMailFilters(db, 'org_1')).resolves.toBeUndefined()
    expect(inserted).toHaveLength(0)
  })

  it('skips a template whose tag the org does not have, rather than inventing one', async () => {
    const { db, inserted } = makeDb(freshRun(SHARED_INBOX, []))
    const tagless = SUGGESTED_MAIL_FILTER_TEMPLATES.filter((t) => !t.requiredTagName)
    expect(tagless.length).toBeLessThan(SUGGESTED_MAIL_FILTER_TEMPLATES.length)

    await seedSuggestedMailFilters(db, 'org_1')

    expect(inserted.map((row) => row.templateKey)).toEqual(tagless.map((t) => t.templateKey))
    for (const row of inserted) {
      for (const action of row.actions as { type: string; tagIds?: string[] }[]) {
        expect(action.type).not.toBe('add-tag')
      }
    }
  })

  it('never throws — org seeding must not fail because a suggestion did not take', async () => {
    const exploding = {
      select: () => {
        throw new Error('boom')
      },
    } as never

    await expect(seedSuggestedMailFilters(exploding, 'org_1')).resolves.toBeUndefined()
  })

  it('busts the mailFilters org-cache key after inserting — stale rows would be invisible', async () => {
    const { db, inserted } = makeDb(freshRun())

    await seedSuggestedMailFilters(db, 'org_1')

    expect(inserted.length).toBeGreaterThan(0)
    expect(h.onCacheEvent).toHaveBeenCalledWith('mail-filter.changed', { orgId: 'org_1' })
  })

  it('does NOT bust the cache when nothing was inserted', async () => {
    // A second, idempotent pass must not flush an org's cache for no reason —
    // and neither must an org with no shared inbox.
    const { db } = makeDb([
      SHARED_INBOX,
      TAGS,
      ...SUGGESTED_MAIL_FILTER_TEMPLATES.map(() => [{ id: 'existing_filter' }]),
    ])
    await seedSuggestedMailFilters(db, 'org_1')
    expect(h.onCacheEvent).not.toHaveBeenCalled()

    const noInbox = makeDb([[]])
    await seedSuggestedMailFilters(noInbox.db, 'org_2')
    expect(h.onCacheEvent).not.toHaveBeenCalled()
  })

  it('swallows a failing cache bust — the never-throws contract covers it too', async () => {
    h.onCacheEvent.mockRejectedValue(new Error('redis down'))
    const { db, inserted } = makeDb(freshRun())

    await expect(seedSuggestedMailFilters(db, 'org_1')).resolves.toBeUndefined()
    // The rows still landed; only the invalidation failed.
    expect(inserted.length).toBeGreaterThan(0)
  })
})

describe('seeded rows never consume the plan allowance (§5.2)', () => {
  it('every seeded row carries a templateKey, and countBillableMailFilters excludes those', async () => {
    // Half one: the seeder always stamps the row.
    const { db, inserted } = makeDb(freshRun())
    await seedSuggestedMailFilters(db, 'org_1')
    expect(inserted.length).toBeGreaterThan(0)
    for (const row of inserted) expect(row.templateKey).toBeTruthy()

    // Half two: the counter's predicate refuses rows that carry one. Asserted on the query
    // the counter builds, so this tracks the predicate rather than its spelling.
    const counter = makeDb([[{ value: 0 }]])
    await countBillableMailFilters(counter.db, 'org_1')
    expect(JSON.stringify(counter.wheres[0])).toContain('"isNull":"MailFilter.templateKey"')
  })
})
