// packages/lib/src/postings/__tests__/gl-account-pointers.test.ts

import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../resources/registry/field-registry'
import {
  describeGlAccountPointers,
  findGlAccountPointers,
  GL_ACCOUNT_POINTER_ATTRIBUTES,
  type GlAccountPointer,
} from '../gl-account-pointers'

/**
 * Every registry attribute that LOOKS like a pointer at a `gl_account`: a TEXT
 * field whose name ends in `_gl_account`, plus the two `payment_gateway`
 * account fields, which are named for their ROLE on the gateway rather than for
 * what they point at.
 *
 * 🛑 Deliberately not "anything ending in `_account`" - that sweeps in
 * `*_bank_account`, which names a `bank_account` instance. Those are a
 * different pointer with a different referent and wiping the CHART does not
 * touch them.
 */
function registryPointerAttributes(): string[] {
  const found = new Set<string>()
  for (const fields of Object.values(RESOURCE_FIELD_REGISTRY)) {
    for (const field of Object.values(fields ?? {})) {
      const attribute = field?.systemAttribute
      if (!attribute) continue
      if (field.fieldType !== 'TEXT') continue
      const isGlPointer = attribute.endsWith('_gl_account')
      const isGatewayAccount =
        attribute === 'payment_gateway_clearing_account' ||
        attribute === 'payment_gateway_fee_account'
      if (isGlPointer || isGatewayAccount) found.add(attribute)
    }
  }
  return [...found].sort()
}

describe('GL_ACCOUNT_POINTER_ATTRIBUTES', () => {
  // 🛑 THE point of this file. A pointer added to the registry and forgotten
  // here is a field `chart-write.ts` will not refuse over and
  // `reset-gl-chart.ts` will wipe straight through - which is exactly how a
  // `payment_gateway` ended up naming an account that did not exist
  // (2026-09-11). One row here is the whole fix; this test is what makes
  // forgetting it loud.
  it('covers every TEXT gl_account pointer in the registry', () => {
    expect(Object.keys(GL_ACCOUNT_POINTER_ATTRIBUTES).sort()).toEqual(registryPointerAttributes())
  })

  it('names something human for each, so a refusal can say what to repoint', () => {
    for (const [attribute, label] of Object.entries(GL_ACCOUNT_POINTER_ATTRIBUTES)) {
      expect(label, attribute).toBeTruthy()
      expect(label, attribute).not.toBe(attribute)
    }
  })

  // The account's OWN attributes are not pointers at an account. Including one
  // would make the chart refuse to remove every account in it.
  it('excludes gl_account attributes and bank_account pointers', () => {
    const keys = Object.keys(GL_ACCOUNT_POINTER_ATTRIBUTES)
    expect(keys).not.toContain('gl_account_code')
    expect(keys).not.toContain('gl_account_name')
    expect(keys).not.toContain('gl_account_type')
    expect(keys).not.toContain('bank_deposit_bank_account')
    expect(keys).not.toContain('bank_transaction_bank_account')
  })

  it('includes the two payment_gateway accounts, which brief 13 §5.3 added', () => {
    expect(Object.keys(GL_ACCOUNT_POINTER_ATTRIBUTES)).toEqual(
      expect.arrayContaining(['payment_gateway_clearing_account', 'payment_gateway_fee_account'])
    )
  })
})

describe('findGlAccountPointers', () => {
  /** A db stub that records the query and answers with `rows`. */
  function stubDb(rows: unknown[]) {
    const calls: { limit?: number } = {}
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: (n: number) => {
        calls.limit = n
        return Promise.resolve(rows)
      },
    }
    return { db: { select: () => chain } as never, calls }
  }

  it('asks nothing of the database for an empty account list', async () => {
    let queried = false
    const db = {
      select: () => {
        queried = true
        return {}
      },
    } as never
    expect(await findGlAccountPointers(db, 'org-1', [])).toEqual([])
    expect(queried).toBe(false)
  })

  it('maps a row onto its human label', async () => {
    const { db } = stubDb([
      {
        attribute: 'payment_gateway_clearing_account',
        entityId: 'pg_1',
        glAccountId: 'acct_1210',
      },
    ])
    expect(await findGlAccountPointers(db, 'org-1', ['acct_1210'])).toEqual([
      {
        attribute: 'payment_gateway_clearing_account',
        label: 'a payment gateway (clearing account)',
        entityId: 'pg_1',
        glAccountId: 'acct_1210',
      },
    ])
  })

  // Both columns are nullable in the schema even though the query filters on
  // them. Dropping the row beats asserting and throwing inside a guard whose
  // whole job is to refuse cleanly.
  it('drops a row with no attribute or no id rather than throwing', async () => {
    const { db } = stubDb([
      { attribute: null, entityId: 'x', glAccountId: 'acct_1210' },
      { attribute: 'bank_account_gl_account', entityId: 'y', glAccountId: null },
      { attribute: 'bank_account_gl_account', entityId: 'z', glAccountId: 'acct_1210' },
    ])
    const found = await findGlAccountPointers(db, 'org-1', ['acct_1210'])
    expect(found).toHaveLength(1)
    expect(found[0]?.entityId).toBe('z')
  })

  it('caps the rows it reads - a refusal needs examples, not every row', async () => {
    const { db, calls } = stubDb([])
    await findGlAccountPointers(db, 'org-1', ['acct_1210'])
    expect(calls.limit).toBe(5)
    await findGlAccountPointers(db, 'org-1', ['acct_1210'], 500)
    expect(calls.limit).toBe(500)
  })

  it('falls back to the raw attribute when one carries no label', async () => {
    const { db } = stubDb([
      { attribute: 'some_future_gl_account', entityId: 'q', glAccountId: 'acct_1210' },
    ])
    const found = await findGlAccountPointers(db, 'org-1', ['acct_1210'])
    expect(found[0]?.label).toBe('some_future_gl_account')
  })
})

describe('describeGlAccountPointers', () => {
  const pointer = (label: string): GlAccountPointer => ({
    attribute: 'x',
    label,
    entityId: 'e',
    glAccountId: 'a',
  })

  it('is null for nothing, so a caller can treat it as the whole question', () => {
    expect(describeGlAccountPointers([])).toBeNull()
  })

  it('names one', () => {
    expect(describeGlAccountPointers([pointer('a payment gateway (clearing account)')])).toBe(
      'a payment gateway (clearing account)'
    )
  })

  // Two gateways pointing at one account is ORDINARY - the entity's own header
  // says two rails can share a clearing account - so the sentence must not
  // repeat itself.
  it('collapses duplicates', () => {
    expect(describeGlAccountPointers([pointer('a bank rule'), pointer('a bank rule')])).toBe(
      'a bank rule'
    )
  })

  it('joins several readably', () => {
    expect(
      describeGlAccountPointers([
        pointer('a bank account'),
        pointer('a bank rule'),
        pointer('a stock movement'),
      ])
    ).toBe('a bank account, a bank rule and a stock movement')
  })
})
