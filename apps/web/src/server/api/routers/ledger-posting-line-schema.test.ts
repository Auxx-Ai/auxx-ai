// apps/web/src/server/api/routers/ledger-posting-line-schema.test.ts
//
// One rule, and it is the only one this file exists for: a wire line names an
// account ROLE or an account CODE, never both. A zod object strips unknown
// keys, so a non-strict union silently deleted the second name and made
// `build-entry.ts`'s both-at-once refusal unreachable from the wire.

import { describe, expect, it, vi } from 'vitest'

// The router reaches `~/server/api/trpc` -> `~/auth/session`, whose first line
// is `import 'server-only'` - a module that throws outside a React server
// component. Nothing below runs a procedure; only the input schema is under
// test.
vi.mock('server-only', () => ({}))

import { postingLine } from './ledger'

const base = {
  direction: 'debit' as const,
  amount: 10_000,
  sourceType: 'journal_entry',
  sourceId: 'je_1',
  sortOrder: 0,
}

describe('postingLine', () => {
  it('accepts a role line', () => {
    const parsed = postingLine.parse({ accountRole: 'accounts_receivable', ...base })
    expect(parsed).toMatchObject({ accountRole: 'accounts_receivable', amount: 10_000 })
  })

  it('accepts a code line', () => {
    const parsed = postingLine.parse({ accountCode: '6300', ...base })
    expect(parsed).toMatchObject({ accountCode: '6300' })
  })

  it('REFUSES a line naming both a role and a code, rather than silently dropping one', () => {
    const both = { accountRole: 'accounts_receivable', accountCode: '1310', ...base }
    expect(() => postingLine.parse(both)).toThrow()

    // The precise failure mode this guards: without `.strict()` the union takes
    // the role branch and the code is gone by the time anything downstream can
    // object to it.
    const result = postingLine.safeParse(both)
    expect(result.success).toBe(false)
  })

  it('refuses a line naming neither', () => {
    expect(postingLine.safeParse(base).success).toBe(false)
  })

  it('refuses an unknown key on either branch', () => {
    expect(
      postingLine.safeParse({ accountRole: 'accounts_receivable', ...base, dimensions: {} }).success
    ).toBe(false)
    expect(postingLine.safeParse({ accountCode: '6300', ...base, note: 'x' }).success).toBe(false)
  })
})
