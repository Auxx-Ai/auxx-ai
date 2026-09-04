// packages/lib/src/postings/__tests__/resolve-roles.test.ts
//
// The resolver is the single door from a builder's ROLE to an org's own account,
// and it is the last thing standing between an entry and the wrong account. The
// entry would still BALANCE if it resolved wrongly, so nothing downstream could
// detect it — which is why every one of these is a refusal test.
//
// Two properties carry the file:
//
//  1. **It fails CLOSED on five distinct conditions, with five distinct
//     messages.** "You never mapped this", "you marked it unused and the books
//     disagree", "the account moved under the mapping", "the account is
//     inactive" and "the mapping is to the wrong KIND of account" call for
//     three different actions by three different people. Collapsing them into
//     "not mapped" is the cheap version and it is wrong.
//  2. **It is a BATCH.** Six unmapped roles must fail ONCE naming six, not six
//     times naming one — a bookkeeper fixing a close needs the list.
//
// The database is a hand-written stub rather than a mock chain: this module
// issues three distinct reads and each has to answer differently, which a
// generic chainable spy cannot express.

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** systemAttribute -> field id, or absent to model an unmigrated org. */
  fields: new Map<string, string>(),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.has(a) ? { id: h.fields.get(a) } : null])),
    }),
  }),
}))

import { loadRoleAccountCodes, resolveAccountLines, resolveRoles } from '../resolve-roles'
import type { GlPostingLineInput } from '../types'

const ORG = 'org_1'

const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

interface Assignment {
  role: string
  glAccountId: string
  markedUnused?: boolean
}

interface Account {
  id: string
  code?: string
  name?: string
  accountType?: string
  isActive?: boolean
  /** Archived rows are excluded by the query, so this models "not returned". */
  archived?: boolean
}

/**
 * A stub `Database` answering this module's three reads in the order it makes
 * them: assignments, live instances, then field values.
 *
 * `assignmentsOverride` exists for the one case Postgres makes unreachable — two
 * rows for one role — which the module asserts anyway.
 */
function stubDb(assignments: Assignment[], accounts: Account[]) {
  let call = 0
  const chain = (rows: unknown[]) => ({
    where: () => chain(rows),
    limit: () => chain(rows),
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  })

  const live = accounts.filter((a) => !a.archived)
  const values = live.flatMap((account) => {
    const rows: Record<string, unknown>[] = []
    if (account.code !== undefined) {
      rows.push({ entityId: account.id, fieldId: CODE_FIELD, valueText: account.code })
    }
    if (account.name !== undefined) {
      rows.push({ entityId: account.id, fieldId: NAME_FIELD, valueText: account.name })
    }
    if (account.accountType !== undefined) {
      rows.push({ entityId: account.id, fieldId: TYPE_FIELD, optionId: account.accountType })
    }
    if (account.isActive !== undefined) {
      rows.push({ entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: account.isActive })
    }
    return rows
  })

  return {
    select: () => ({
      from: () => {
        call++
        // 1: GlRoleAssignment. 2: the live EntityInstances. 3: their FieldValues.
        if (call === 1) {
          return chain(
            assignments.map((a) => ({
              role: a.role,
              glAccountId: a.glAccountId,
              markedUnused: a.markedUnused ?? false,
            }))
          )
        }
        if (call === 2) return chain(live.map((a) => ({ id: a.id })))
        return chain(values)
      },
    }),
  } as unknown as Database
}

/** A well-formed GRNI mapping: the happy path every refusal test perturbs. */
const GRNI_ASSIGNMENT: Assignment = { role: 'grni', glAccountId: 'acct_grni' }
const GRNI_ACCOUNT: Account = {
  id: 'acct_grni',
  code: '2160',
  name: 'Goods Received Not Invoiced',
  accountType: 'liability',
  isActive: true,
}

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', CODE_FIELD],
    ['gl_account_name', NAME_FIELD],
    ['gl_account_type', TYPE_FIELD],
    ['gl_account_is_active', ACTIVE_FIELD],
  ])
})

async function expectErr(
  promise: ReturnType<typeof resolveRoles> | ReturnType<typeof resolveAccountLines>
) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

describe('resolveRoles — the happy path', () => {
  it('resolves a mapped role to its code, name and type', async () => {
    const db = stubDb([GRNI_ASSIGNMENT], [GRNI_ACCOUNT])
    const result = await resolveRoles(db, ORG, ['grni'])

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().get('grni')).toEqual({
      glAccountId: 'acct_grni',
      code: '2160',
      name: 'Goods Received Not Invoiced',
      accountType: 'liability',
      isActive: true,
    })
  })

  it('resolves an empty request to an empty map without touching the database', async () => {
    const db = stubDb([], [])
    const result = await resolveRoles(db, ORG, [])
    expect(result._unsafeUnwrap().size).toBe(0)
  })

  it('collapses a duplicate role in the request', async () => {
    const db = stubDb([GRNI_ASSIGNMENT], [GRNI_ACCOUNT])
    const result = await resolveRoles(db, ORG, ['grni', 'grni'])
    expect(result._unsafeUnwrap().size).toBe(1)
  })

  // 🛑 The exact case `G19` names, and the reason this is a table rather than a
  // `unique: true` SINGLE_SELECT on `gl_account`: a role resolves to ONE account
  // (enforced) but an account may serve MANY roles (permitted, ordinary — an org
  // that runs DTC and dealer revenue through one account).
  it('lets two roles share one account', async () => {
    const db = stubDb(
      [
        { role: 'ppv', glAccountId: 'acct_var' },
        { role: 'inventory_count_variance', glAccountId: 'acct_var' },
      ],
      [{ id: 'acct_var', code: '5090', name: 'Variances', accountType: 'expense', isActive: true }]
    )
    const result = await resolveRoles(db, ORG, ['ppv', 'inventory_count_variance'])

    expect(result.isOk()).toBe(true)
    const resolved = result._unsafeUnwrap()
    expect(resolved.get('ppv')?.glAccountId).toBe('acct_var')
    expect(resolved.get('inventory_count_variance')?.glAccountId).toBe('acct_var')
  })

  // `gl_account_is_active` declares `defaultValue: true`, and an account written
  // before the field existed has no row at all. The opposite reading would
  // refuse to post to a chart nobody has ever deactivated anything in.
  it('treats a missing active flag as active', async () => {
    const db = stubDb([GRNI_ASSIGNMENT], [{ ...GRNI_ACCOUNT, isActive: undefined }])
    expect((await resolveRoles(db, ORG, ['grni'])).isOk()).toBe(true)
  })
})

describe('resolveRoles — the five refusals, each with its own message', () => {
  it('1. refuses a role nobody ever mapped', async () => {
    const db = stubDb([], [])
    const error = await expectErr(resolveRoles(db, ORG, ['grni']))
    expect(error.message).toContain("'grni'")
    expect(error.message).toMatch(/not mapped to any account/i)
  })

  it('2. refuses a role the org marked unused, and says the books disagree', async () => {
    const db = stubDb([{ ...GRNI_ASSIGNMENT, markedUnused: true }], [GRNI_ACCOUNT])
    const error = await expectErr(resolveRoles(db, ORG, ['grni']))
    expect(error.message).toMatch(/marked as unused/i)
    // NOT the "never mapped" sentence — the two call for different actions.
    expect(error.message).not.toMatch(/not mapped to any account/i)
  })

  it.each([
    ['missing', [] as Account[]],
    ['archived', [{ ...GRNI_ACCOUNT, archived: true }]],
  ])('3. refuses when the mapped account is %s', async (_label, accounts) => {
    const db = stubDb([GRNI_ASSIGNMENT], accounts)
    const error = await expectErr(resolveRoles(db, ORG, ['grni']))
    expect(error.message).toMatch(/no longer exists or has been archived/i)
  })

  it('4. refuses an inactive account, and names it', async () => {
    const db = stubDb([GRNI_ASSIGNMENT], [{ ...GRNI_ACCOUNT, isActive: false }])
    const error = await expectErr(resolveRoles(db, ORG, ['grni']))
    expect(error.message).toMatch(/not active/i)
    expect(error.message).toContain('2160')
  })

  // 🛑 The one a balanced entry hides completely. `grni` on a revenue account
  // posts, balances, and misstates the books until a close.
  it('5. refuses an account of the wrong statement type, naming both types', async () => {
    const db = stubDb([GRNI_ASSIGNMENT], [{ ...GRNI_ACCOUNT, accountType: 'revenue' }])
    const error = await expectErr(resolveRoles(db, ORG, ['grni']))
    expect(error.message).toMatch(/must be mapped to a liability account/i)
    expect(error.message).toMatch(/is a revenue account/i)
  })

  // A role outside `ACCOUNT_ROLES` is a closed-vocabulary violation, not a
  // mapping problem, so it gets its own sentence rather than a type mismatch.
  it('refuses an undeclared role as a vocabulary violation', async () => {
    const db = stubDb(
      [{ role: 'invented', glAccountId: 'acct_x' }],
      [{ id: 'acct_x', code: '9999', name: 'Whatever', accountType: 'expense', isActive: true }]
    )
    const error = await expectErr(resolveRoles(db, ORG, ['invented']))
    expect(error.message).toMatch(/not a declared posting role/i)
  })

  // An account with no code cannot produce a ledger line at all — `P2` stores
  // the code — so absence is a refusal rather than a blank.
  it('refuses an account carrying no code', async () => {
    const db = stubDb([GRNI_ASSIGNMENT], [{ ...GRNI_ACCOUNT, code: undefined }])
    const error = await expectErr(resolveRoles(db, ORG, ['grni']))
    expect(error.message).toMatch(/no longer exists or has been archived/i)
  })

  it('refuses when the chart is not provisioned for the org at all', async () => {
    h.fields.delete('gl_account_code')
    const db = stubDb([GRNI_ASSIGNMENT], [GRNI_ACCOUNT])
    const error = await expectErr(resolveRoles(db, ORG, ['grni']))
    expect(error.message).toMatch(/not provisioned/i)
  })
})

describe('resolveRoles — it answers for the whole set at once', () => {
  // 🛑 A month-end entry naming six roles on an org that mapped none must fail
  // ONCE, naming all six. Six failures naming one each is a treasure hunt on
  // the night of a close.
  it('names every failing role in a single error', async () => {
    const db = stubDb([], [])
    const roles = ['grni', 'ppv', 'cash', 'inventory_wip', 'cogs_product_cost', 'applied_overhead']
    const error = await expectErr(resolveRoles(db, ORG, roles))

    for (const role of roles) expect(error.message, role).toContain(`'${role}'`)
    expect(error.message).toContain('6 posting role(s)')
  })

  // Partial success is not success: one unresolvable leg makes the whole entry
  // unpostable, so returning the resolvable ones would invite a caller to post
  // half of it.
  it('refuses the whole set when one role fails, resolving none', async () => {
    const db = stubDb([GRNI_ASSIGNMENT], [GRNI_ACCOUNT])
    const result = await resolveRoles(db, ORG, ['grni', 'ppv'])
    expect(result.isErr()).toBe(true)
  })

  it('reports each failing role with the reason that applies to IT', async () => {
    const db = stubDb(
      [
        { role: 'ppv', glAccountId: 'acct_ppv', markedUnused: true },
        { role: 'cash', glAccountId: 'acct_cash' },
      ],
      [{ id: 'acct_cash', code: '1000', name: 'Cash', accountType: 'liability', isActive: true }]
    )
    const error = await expectErr(resolveRoles(db, ORG, ['grni', 'ppv', 'cash']))

    expect(error.message).toMatch(/'grni' is not mapped/i)
    expect(error.message).toMatch(/'ppv' is marked as unused/i)
    expect(error.message).toMatch(/'cash' must be mapped to a asset account/i)
  })
})

describe('resolveRoles — the impossible case, asserted anyway', () => {
  // `GlRoleAssignment_org_role_key` makes this unreachable. It is asserted
  // because the ONE failure this module must never have is picking arbitrarily
  // between two accounts: the entry would balance, and nothing downstream could
  // tell. "Take the first" is not an option.
  it('refuses rather than choosing when two rows claim one role', async () => {
    const db = stubDb(
      [
        { role: 'grni', glAccountId: 'acct_a' },
        { role: 'grni', glAccountId: 'acct_b' },
      ],
      [
        { id: 'acct_a', code: '2160', name: 'A', accountType: 'liability', isActive: true },
        { id: 'acct_b', code: '2155', name: 'B', accountType: 'liability', isActive: true },
      ]
    )
    const error = await expectErr(resolveRoles(db, ORG, ['grni']))
    expect(error.message).toMatch(/more than one account/i)
    expect(error.message).toMatch(/Refusing to choose/i)
  })
})

// ── HANDOFF slot 1A: code lines ───────────────────────────────────────────
//
// A human coding an adjusting entry names an ACCOUNT, not a role. The property
// this block exists to hold is that the second shape is not a cheaper door: a
// code is validated against the org's chart with the same batched refusals a
// role gets, and an entry naming six bad accounts fails ONCE naming six.

/**
 * A stub that dispatches on the TABLE rather than on a call counter.
 *
 * `resolveAccountLines` issues a different number of reads depending on whether
 * the entry has role lines, code lines or both, so the counter the stub above
 * uses cannot model it. Keying on the table object is what
 * `reverse-entry.test.ts` does for the same reason.
 */
function stubLineDb(assignments: Assignment[], accounts: Account[]) {
  const live = accounts.filter((a) => !a.archived)
  const chain = (rows: unknown[]) => ({
    where: () => chain(rows),
    limit: () => chain(rows),
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  })

  const values = live.flatMap((account) => {
    const rows: Record<string, unknown>[] = []
    if (account.code !== undefined) {
      rows.push({ entityId: account.id, fieldId: CODE_FIELD, valueText: account.code })
    }
    if (account.name !== undefined) {
      rows.push({ entityId: account.id, fieldId: NAME_FIELD, valueText: account.name })
    }
    if (account.accountType !== undefined) {
      rows.push({ entityId: account.id, fieldId: TYPE_FIELD, optionId: account.accountType })
    }
    if (account.isActive !== undefined) {
      rows.push({ entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: account.isActive })
    }
    return rows
  })

  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.GlRoleAssignment) {
          return chain(
            assignments.map((a) => ({
              role: a.role,
              glAccountId: a.glAccountId,
              markedUnused: a.markedUnused ?? false,
            }))
          )
        }
        if (table === schema.EntityInstance) return chain(live.map((a) => ({ id: a.id })))
        // Both the by-code lookup and the value decode read `FieldValue`. The
        // by-code lookup asks for `entityId` only and ignores the rest, so one
        // answer serves both.
        return chain(values)
      },
    }),
  } as unknown as Database
}

const EXPENSE: Account = {
  id: 'acct_bad_debt',
  code: '6300',
  name: 'Bad Debt Expense',
  accountType: 'expense',
  isActive: true,
}

function codeLine(accountCode: string, sortOrder = 0): GlPostingLineInput {
  return {
    accountCode,
    direction: sortOrder === 0 ? 'debit' : 'credit',
    amount: 1000,
    sourceType: 'journal_entry',
    sourceId: 'je_1',
    sortOrder,
  }
}

describe('resolveAccountLines - code lines', () => {
  it('resolves a code to the account the chart holds under it', async () => {
    const db = stubLineDb([], [EXPENSE])
    const result = await resolveAccountLines(db, ORG, [codeLine('6300')])

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([
      {
        glAccountId: 'acct_bad_debt',
        code: '6300',
        name: 'Bad Debt Expense',
        accountType: 'expense',
        isActive: true,
      },
    ])
  })

  it('returns one account per line, in the SAME order as the input', async () => {
    const db = stubLineDb([], [EXPENSE, GRNI_ACCOUNT])
    const result = await resolveAccountLines(db, ORG, [codeLine('2160', 0), codeLine('6300', 1)])
    expect(result._unsafeUnwrap().map((a) => a.code)).toEqual(['2160', '6300'])
  })

  it('resolves an empty line array to an empty result', async () => {
    const db = stubLineDb([], [])
    const result = await resolveAccountLines(db, ORG, [])
    expect(result._unsafeUnwrap()).toEqual([])
  })

  // The same five refusals a role gets, minus the two that have no code
  // counterpart (`markedUnused` is a property of a MAPPING, and a code has no
  // declared type to be incompatible with - see the JSDoc).
  it('refuses a code the chart does not hold, naming the row', async () => {
    const db = stubLineDb([], [EXPENSE])
    const error = await expectErr(resolveAccountLines(db, ORG, [codeLine('9999')]))
    expect(error.message).toMatch(/Row 1/)
    expect(error.message).toMatch(/9999/)
  })

  // Archived is excluded by the QUERY, so from a coder's point of view it reads
  // exactly like an account that never existed - which is the same answer the
  // role resolver gives for a mapping whose account was archived.
  it('refuses an archived account the same way it refuses a missing one', async () => {
    const db = stubLineDb([], [{ ...EXPENSE, archived: true }])
    const error = await expectErr(resolveAccountLines(db, ORG, [codeLine('6300')]))
    expect(error.message).toMatch(/no active account with code '6300'/i)
  })

  it('refuses an inactive account, naming it', async () => {
    const db = stubLineDb([], [{ ...EXPENSE, isActive: false }])
    const error = await expectErr(resolveAccountLines(db, ORG, [codeLine('6300')]))
    expect(error.message).toMatch(/6300 Bad Debt Expense is not active/i)
  })

  // 🛑 `gl_account_code` is unique by REGISTRY CAPABILITY, not by a database
  // constraint, so two live accounts can carry one code through the importer or
  // through two concurrent creates. Picking one would put money in an arbitrary
  // account and the entry would still balance.
  it('refuses rather than choosing when two live accounts carry one code', async () => {
    const db = stubLineDb(
      [],
      [EXPENSE, { id: 'acct_dupe', code: '6300', name: 'Bad Debt', accountType: 'expense' }]
    )
    const error = await expectErr(resolveAccountLines(db, ORG, [codeLine('6300')]))
    expect(error.message).toMatch(/carried by 2 accounts/i)
    expect(error.message).toMatch(/Refusing to choose/i)
  })

  // The batch property, at the line level. A bookkeeper fixing an entry needs
  // the list, not a treasure hunt.
  it('names EVERY bad row in one message', async () => {
    const db = stubLineDb([], [EXPENSE])
    const error = await expectErr(
      resolveAccountLines(db, ORG, [codeLine('9998', 0), codeLine('9999', 1)])
    )
    expect(error.message).toMatch(/Row 1/)
    expect(error.message).toMatch(/Row 2/)
    expect(error.message).toMatch(/9998/)
    expect(error.message).toMatch(/9999/)
    expect(error.message).toMatch(/2 line\(s\)/)
  })

  it('refuses a line that names neither a role nor a code', async () => {
    const db = stubLineDb([], [EXPENSE])
    const bare = { ...codeLine('6300') } as Record<string, unknown>
    bare.accountCode = ''
    const error = await expectErr(
      resolveAccountLines(db, ORG, [bare as unknown as GlPostingLineInput])
    )
    expect(error.message).toMatch(/neither an account role nor an account code/i)
  })
})

describe('resolveAccountLines - role lines and mixed entries', () => {
  it('resolves a role line through the existing door, unchanged', async () => {
    const db = stubLineDb([GRNI_ASSIGNMENT], [GRNI_ACCOUNT])
    const result = await resolveAccountLines(db, ORG, [
      {
        accountRole: 'grni',
        direction: 'credit',
        amount: 1000,
        sourceType: 'stock_movement',
        sourceId: 'mv_1',
        sortOrder: 0,
      },
    ])
    expect(result._unsafeUnwrap()[0]?.code).toBe('2160')
  })

  it('resolves an entry that mixes both shapes', async () => {
    const db = stubLineDb([GRNI_ASSIGNMENT], [GRNI_ACCOUNT, EXPENSE])
    const result = await resolveAccountLines(db, ORG, [
      {
        accountRole: 'grni',
        direction: 'credit',
        amount: 1000,
        sourceType: 'stock_movement',
        sourceId: 'mv_1',
        sortOrder: 0,
      },
      codeLine('6300', 1),
    ])
    expect(result._unsafeUnwrap().map((a) => a.code)).toEqual(['2160', '6300'])
  })

  it("carries the role resolver's own message through, unedited", async () => {
    const db = stubLineDb([], [EXPENSE])
    const error = await expectErr(
      resolveAccountLines(db, ORG, [
        {
          accountRole: 'grni',
          direction: 'credit',
          amount: 1000,
          sourceType: 'stock_movement',
          sourceId: 'mv_1',
          sortOrder: 0,
        },
      ])
    )
    expect(error.message).toMatch(/'grni' is not mapped to any account/i)
  })
})

describe('loadRoleAccountCodes', () => {
  // It answers a QUESTION rather than posting, so an unmapped role is genuinely
  // "none" and must not refuse. The one caller is the inventory-by-name guard,
  // and an org that has never mapped `inventory_wip` has nothing to protect.
  it('returns nothing, rather than refusing, for an unmapped role', async () => {
    const db = stubLineDb([], [])
    const found = await loadRoleAccountCodes(db, ORG, ['inventory_wip'])
    expect(found.size).toBe(0)
  })

  it('returns the account a mapped role points at', async () => {
    const db = stubLineDb([GRNI_ASSIGNMENT], [GRNI_ACCOUNT])
    const found = await loadRoleAccountCodes(db, ORG, ['grni'])
    expect(found.get('grni')?.code).toBe('2160')
  })

  it('skips a role somebody marked unused', async () => {
    const db = stubLineDb([{ ...GRNI_ASSIGNMENT, markedUnused: true }], [GRNI_ACCOUNT])
    const found = await loadRoleAccountCodes(db, ORG, ['grni'])
    expect(found.size).toBe(0)
  })
})
