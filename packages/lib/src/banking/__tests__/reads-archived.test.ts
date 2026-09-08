// packages/lib/src/banking/__tests__/reads-archived.test.ts

/**
 * The two reads the removal feature added
 * (plans/bank-connection/08-removing-a-bank-account.md §7.2, §8).
 *
 * 🛑 `listBankAccounts` must exclude archived rows BY DEFAULT. Every existing
 * caller - the settings list, every picker, the review queue, the importer -
 * passes nothing, and archiving is only "removal" as far as the product is
 * concerned because the query already filters. A default that flipped would put
 * removed accounts back into every dropdown in the app.
 *
 * 🛑 `readRemovalFacts` must read `hasEverPosted` STRAIGHT OFF THE FIELD. The
 * test below hands it an account whose every transaction is back in `for_review`
 * with no posting id - what the queue looks like after an undo - and a stored
 * flag that says `true`, and the fact has to come back `true`.
 */

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every `where` fragment the module built, in order. */
  wheres: [] as unknown[],
  /** The rows each successive query resolves to. */
  script: [] as unknown[][],
  rules: [] as {
    id: string
    name: string
    bankAccountId: string | null
    counterpartBankAccountId: string | null
  }[],
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: async (_org: string, entityType: string) =>
    entityType === 'bank_account' ? 'def_ba' : 'def_bt',
  getOrgCache: () => ({
    from: () => ({
      // Every attribute resolves to a field whose id IS the attribute name, so a
      // captured predicate is legible without a fixture table.
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, { id: attr }])),
    }),
  }),
}))

vi.mock('../rules/reads', () => ({
  listBankRules: async () => ({ isErr: () => false, isOk: () => true, value: h.rules }),
}))

const { listBankAccounts, readRemovalFacts } = await import('../reads')

/**
 * The SQL a drizzle fragment renders to, so a predicate can be asserted.
 *
 * ⚠️ Rendered OUTSIDE a query builder, so column references come back blank and
 * values are bound parameters - the same trade `feed/__tests__/reaper.test.ts`
 * makes. What is pinned here is the SHAPE (is there an `is null` arm at all),
 * which is exactly the difference `includeArchived` makes.
 */
function render(fragment: unknown): string {
  return new PgDialect().sqlToQuery(fragment as never).sql
}

/**
 * One query stage: chainable and awaitable, resolving to `rows`.
 *
 * The same shape `review/__tests__/writes.test.ts` builds - a promise with the
 * builder methods hung off it - so every stage can be either the terminal one or
 * the next link without the double knowing which.
 */
function stage(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'limit', 'orderBy']) {
    chain[method] = () => stage(rows)
  }
  chain.where = (fragment: unknown) => {
    h.wheres.push(fragment)
    return stage(rows)
  }
  return Object.assign(Promise.resolve(rows), chain)
}

/** A db double that answers `h.script` in order and records every `where`. */
function fakeDb() {
  let call = 0
  // One `select()` is one query, so the script advances here rather than at the
  // await - which is what keeps the scripted rows lined up with the call order.
  return { select: () => stage(h.script[call++] ?? []) } as never
}

const ORG = 'org_1'

beforeEach(() => {
  h.wheres.length = 0
  h.script.length = 0
  h.rules = []
})

describe('listBankAccounts', () => {
  it('excludes archived rows by default', async () => {
    h.script.push([]) // no instances, so nothing hydrates
    const result = await listBankAccounts(fakeDb(), { organizationId: ORG })

    expect(result.isOk()).toBe(true)
    expect(render(h.wheres[0])).toContain('is null')
  })

  it('includes them on the flag', async () => {
    h.script.push([])
    const result = await listBankAccounts(fakeDb(), {
      organizationId: ORG,
      includeArchived: true,
    })

    expect(result.isOk()).toBe(true)
    // 🛑 The ONLY difference between the two calls. If this arm survives the
    // flag, "Show archived" shows nothing and a picker cannot render an archived
    // account that is still a record's current value.
    expect(render(h.wheres[0])).not.toContain('is null')
  })

  it('carries archivedAt onto the row so the list can dim it', async () => {
    const archivedAt = new Date('2026-09-08T00:00:00.000Z')
    h.script.push([{ id: 'acct_1', createdAt: null, archivedAt }])
    h.script.push([
      { entityId: 'acct_1', fieldId: 'bank_account_name', valueText: 'Old account' },
      { entityId: 'acct_1', fieldId: 'bank_account_has_posted', valueBoolean: true },
    ])

    const result = await listBankAccounts(fakeDb(), {
      organizationId: ORG,
      includeArchived: true,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value[0]?.archivedAt).toEqual(archivedAt)
      expect(result.value[0]?.hasEverPosted).toBe(true)
    }
  })

  it('reads hasEverPosted as false when the field carries nothing', async () => {
    h.script.push([{ id: 'acct_1', createdAt: null, archivedAt: null }])
    h.script.push([{ entityId: 'acct_1', fieldId: 'bank_account_name', valueText: 'New account' }])

    const result = await listBankAccounts(fakeDb(), { organizationId: ORG })
    if (result.isOk()) expect(result.value[0]?.hasEverPosted).toBe(false)
  })
})

describe('readRemovalFacts', () => {
  it('reads hasEverPosted off the FIELD, not off the rows', async () => {
    // 1. getBankAccount's instance row (archived rows allowed through).
    h.script.push([{ id: 'acct_1', createdAt: null, archivedAt: null }])
    // 2. its field values: the flag is TRUE and nothing else says so.
    h.script.push([
      { entityId: 'acct_1', fieldId: 'bank_account_name', valueText: 'Chequing' },
      { entityId: 'acct_1', fieldId: 'bank_account_has_posted', valueBoolean: true },
    ])
    // 3. the account's live lines...
    h.script.push([{ entityId: 'txn_1' }, { entityId: 'txn_2' }])
    // 4. ...every one of which is back in `for_review` with no posting id, which
    //    is exactly what the queue looks like after `undoReview`.
    h.script.push([
      { entityId: 'txn_1', optionId: 'for_review' },
      { entityId: 'txn_2', optionId: 'for_review' },
    ])

    const result = await readRemovalFacts(fakeDb(), {
      organizationId: ORG,
      bankAccountId: 'acct_1',
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.hasEverPosted).toBe(true)
      expect(result.value.transactionCount).toBe(2)
      expect(result.value.unreviewedCount).toBe(2)
      expect(result.value.matchedCount).toBe(0)
    }
  })

  it('counts matched and unreviewed lines separately', async () => {
    h.script.push([{ id: 'acct_1', createdAt: null, archivedAt: null }])
    h.script.push([{ entityId: 'acct_1', fieldId: 'bank_account_name', valueText: 'Chequing' }])
    h.script.push([
      { entityId: 'txn_1' },
      { entityId: 'txn_2' },
      { entityId: 'txn_3' },
      { entityId: 'txn_4' },
    ])
    h.script.push([
      { entityId: 'txn_1', optionId: 'matched' },
      { entityId: 'txn_2', optionId: 'coded' },
      { entityId: 'txn_3', optionId: 'suggested' },
      { entityId: 'txn_4', optionId: 'for_review' },
    ])

    const result = await readRemovalFacts(fakeDb(), {
      organizationId: ORG,
      bankAccountId: 'acct_1',
    })

    if (result.isOk()) {
      expect(result.value.transactionCount).toBe(4)
      expect(result.value.matchedCount).toBe(1)
      expect(result.value.unreviewedCount).toBe(2)
    }
  })

  it('names the rules pointing at the account, in either field', async () => {
    h.rules = [
      { id: 'rule_1', name: 'Bank fee', bankAccountId: 'acct_1', counterpartBankAccountId: null },
      {
        id: 'rule_2',
        name: 'Sweep to savings',
        bankAccountId: 'acct_9',
        counterpartBankAccountId: 'acct_1',
      },
      { id: 'rule_3', name: 'Unrelated', bankAccountId: 'acct_9', counterpartBankAccountId: null },
    ]
    h.script.push([{ id: 'acct_1', createdAt: null, archivedAt: null }])
    h.script.push([{ entityId: 'acct_1', fieldId: 'bank_account_name', valueText: 'Chequing' }])
    h.script.push([])

    const result = await readRemovalFacts(fakeDb(), {
      organizationId: ORG,
      bankAccountId: 'acct_1',
    })

    if (result.isOk()) {
      expect(result.value.rules.map((rule) => rule.id)).toEqual(['rule_1', 'rule_2'])
    }
  })

  it('refuses by name when the account does not exist', async () => {
    h.script.push([])

    const result = await readRemovalFacts(fakeDb(), {
      organizationId: ORG,
      bankAccountId: 'gone',
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toContain('gone')
  })
})
