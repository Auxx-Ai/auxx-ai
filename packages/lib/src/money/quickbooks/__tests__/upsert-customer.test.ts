// packages/lib/src/money/quickbooks/__tests__/upsert-customer.test.ts
//
// The ladder from plans/accounting/tasks/23 §2, and above all §2.4's decision
// table. The test that matters most is "two John Smiths": the brief's own first
// draft said "on 6240, re-query and adopt the winner", which would have merged
// two people's receivables under one customer. It balances, the aging foots, and
// nothing downstream can detect it - so it has to be caught here or nowhere.

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const readQuickbooksIdField = vi.fn()
const writeQuickbooksIdField = vi.fn()
vi.mock('../identity-field', () => ({
  readQuickbooksIdField: (...a: unknown[]) => readQuickbooksIdField(...a),
  writeQuickbooksIdField: (...a: unknown[]) => writeQuickbooksIdField(...a),
}))

import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { customerStamp, upsertQuickbooksCustomer } from '../upsert-customer'

const ORG_ID = 'org1'
const CONTACT_ID = 'contact_aaa111bbb222'
const OTHER_CONTACT_ID = 'contact_zzz999yyy888'
const handler = {} as never // opaque - only threaded through to the mocked identity-field reads

/**
 * The `callTool` double, typed to the tool seam rather than to `vi.fn()`'s
 * default union - a bare `ReturnType<typeof vi.fn>` is `Mock<Constructable |
 * Procedure>` and will not satisfy `QuickbooksToolContext`.
 */
// biome-ignore lint/suspicious/noExplicitAny: tool payloads are per-tool shapes
type ToolMock = Mock<(toolId: string, inputs: any) => Promise<any>>

function buildCtx(callTool: ToolMock = vi.fn()): QuickbooksToolContext {
  return {
    organizationId: ORG_ID,
    installationId: 'install1',
    connectionId: 'conn1',
    userId: 'user1',
    callTool,
  }
}

function run(callTool: ToolMock, fields: Record<string, string | undefined>) {
  return upsertQuickbooksCustomer(buildCtx(callTool), {
    organizationId: ORG_ID,
    contactInstanceId: CONTACT_ID,
    contactFields: fields,
    handler,
  })
}

/** `find_quickbooks_customer`'s "nothing matched" answer. */
const NOT_FOUND = { found: false, customer: null, notImportedReason: null }

/** One found customer, in the tool's own shape. */
function found(over: Record<string, unknown> = {}) {
  return {
    found: true,
    customer: {
      customerId: '99',
      displayName: 'Jane Doe',
      email: null,
      notes: null,
      active: true,
      ...over,
    },
    notImportedReason: null,
  }
}

/** Intuit's duplicate-`DisplayName` fault, as the tool layer surfaces it. */
function duplicateNameFault() {
  return Object.assign(new Error('Duplicate Name Exists Error: code 6240'), {
    code: 'INVALID_INPUT',
  })
}

/**
 * Route `callTool` by tool id and, for finds, by the key being searched - the
 * ladder asks for several different names in one run, so a positional
 * `mockResolvedValueOnce` chain becomes unreadable fast.
 */
function router(handlers: {
  byEmail?: Record<string, unknown>
  byName?: Record<string, unknown>
  // biome-ignore lint/suspicious/noExplicitAny: tool payloads are per-tool shapes
  create?: (inputs: any) => unknown
}): ToolMock {
  return vi.fn(async (toolId: string, inputs: any) => {
    if (toolId === 'find_quickbooks_customer') {
      if (inputs.email) return handlers.byEmail?.[inputs.email] ?? NOT_FOUND
      return handlers.byName?.[inputs.displayName] ?? NOT_FOUND
    }
    if (toolId === 'create_quickbooks_customer') {
      if (handlers.create) return handlers.create(inputs)
      return { customerId: '101', displayName: inputs.displayName }
    }
    return {}
  })
}

function createCalls(callTool: ToolMock) {
  return callTool.mock.calls.filter(([id]) => id === 'create_quickbooks_customer').map((c) => c[1])
}

beforeEach(() => {
  readQuickbooksIdField.mockReset()
  writeQuickbooksIdField.mockReset()
  readQuickbooksIdField.mockResolvedValue(undefined)
})

describe('layer 1 - the stored id', () => {
  it('returns it without calling any QuickBooks tool', async () => {
    readQuickbooksIdField.mockResolvedValue('qbo-cust-existing')
    const callTool = vi.fn()

    const result = await run(callTool, { firstName: 'Jane', lastName: 'Doe' })

    expect(result).toBe('qbo-cust-existing')
    expect(callTool).not.toHaveBeenCalled()
    expect(writeQuickbooksIdField).not.toHaveBeenCalled()
  })
})

describe('layer 2 - find by email', () => {
  it('adopts the match and writes the id back, with no create', async () => {
    const callTool = router({ byEmail: { 'jane@example.com': found({ customerId: '99' }) } })

    const result = await run(callTool, {
      firstName: 'Jane',
      lastName: 'Doe',
      primaryEmail: 'jane@example.com',
    })

    expect(result).toBe('99')
    expect(createCalls(callTool)).toHaveLength(0)
    expect(writeQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({
        appFieldKey: 'qboCustomerId',
        entityType: 'contact',
        entityInstanceId: CONTACT_ID,
        externalId: '99',
      })
    )
  })

  it('is the identity rule: two contacts on one email land on one customer', async () => {
    // §2.5 and §4.3. They are one person and their A/R should aggregate. The
    // mirror case - one name, two emails - resolves the opposite way below, for
    // the same reason: the email is the identity, the name is only a label.
    const callTool = router({ byEmail: { 'shared@example.com': found({ customerId: '55' }) } })

    const first = await run(callTool, { firstName: 'Jane', primaryEmail: 'shared@example.com' })
    const second = await upsertQuickbooksCustomer(buildCtx(callTool), {
      organizationId: ORG_ID,
      contactInstanceId: OTHER_CONTACT_ID,
      contactFields: { firstName: 'J', lastName: 'Doe', primaryEmail: 'shared@example.com' },
      handler,
    })

    expect(first).toBe('55')
    expect(second).toBe('55')
    expect(createCalls(callTool)).toHaveLength(0)
  })
})

describe('layer 3 - find by display name', () => {
  it('adopts a same-named customer carrying OUR stamp', async () => {
    // §6 acceptance 6. No email on either side, so the stamp is the only thing
    // that can say "this is ours" - and it can, because auxx stamps on create.
    const callTool = router({
      byName: {
        'Jane Doe': found({ customerId: '77', notes: `${customerStamp(CONTACT_ID)} do not edit` }),
      },
    })

    const result = await run(callTool, { firstName: 'Jane', lastName: 'Doe' })

    expect(result).toBe('77')
    expect(createCalls(callTool)).toHaveLength(0)
  })

  it('does NOT create on every attempt for an emailless contact', async () => {
    // What this arm exists for. Before it, an emailless contact went straight
    // from "no email" to "create" and made a new customer every single run.
    const callTool = router({
      byName: { 'Jane Doe': found({ customerId: '77', notes: customerStamp(CONTACT_ID) }) },
    })

    await run(callTool, { firstName: 'Jane', lastName: 'Doe' })
    await run(callTool, { firstName: 'Jane', lastName: 'Doe' })

    expect(createCalls(callTool)).toHaveLength(0)
  })
})

describe('layer 4 - create, and the 6240 decision table (§2.4)', () => {
  it('creates with the plain name and stamps Notes on create only', async () => {
    const callTool = router({})

    const result = await run(callTool, {
      firstName: 'Jane',
      lastName: 'Doe',
      primaryEmail: 'jane@example.com',
    })

    expect(result).toBe('101')
    expect(createCalls(callTool)[0]).toMatchObject({
      displayName: 'Jane Doe',
      givenName: 'Jane',
      familyName: 'Doe',
      email: 'jane@example.com',
      notes: customerStamp(CONTACT_ID),
    })
  })

  it('row 1 - adopts when the winner carries OUR email (the concurrent race)', async () => {
    // Two entries for the same new contact exported at once. One create wins,
    // ours faults, and the winner is plainly us.
    let created = false
    const callTool = vi.fn(async (toolId: string, inputs: any) => {
      if (toolId === 'find_quickbooks_customer') {
        if (inputs.email) return NOT_FOUND
        if (!created) return NOT_FOUND
        return found({ customerId: '200', email: 'jane@example.com' })
      }
      created = true
      throw duplicateNameFault()
    })

    const result = await run(callTool, {
      firstName: 'Jane',
      lastName: 'Doe',
      primaryEmail: 'jane@example.com',
    })

    expect(result).toBe('200')
    expect(writeQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '200' })
    )
  })

  it('row 2 - adopts when the winner carries OUR stamp', async () => {
    let created = false
    const callTool = vi.fn(async (toolId: string, inputs: any) => {
      if (toolId === 'find_quickbooks_customer') {
        if (inputs.email) return NOT_FOUND
        if (!created) return NOT_FOUND
        return found({ customerId: '201', notes: customerStamp(CONTACT_ID) })
      }
      created = true
      throw duplicateNameFault()
    })

    const result = await run(callTool, { firstName: 'Jane', lastName: 'Doe' })

    expect(result).toBe('201')
  })

  it('🛑 row 3 - TWO John Smiths get TWO customers, never one', async () => {
    // §6 acceptance 4, and the test that would have caught the brief's own
    // first draft. The existing Smith carries a different email, which is
    // positive evidence of a different person, so the label is relabelled and a
    // SECOND customer is created. Adopting here would merge two people's
    // receivables and nothing downstream could ever detect it.
    const callTool = router({
      byName: {
        'John Smith': found({
          customerId: '300',
          displayName: 'John Smith',
          email: 'the.other.john@example.com',
        }),
      },
      create: (inputs: any) => ({ customerId: '301', displayName: inputs.displayName }),
    })

    const result = await run(callTool, {
      firstName: 'John',
      lastName: 'Smith',
      primaryEmail: 'our.john@example.com',
    })

    expect(result).toBe('301')
    expect(result).not.toBe('300')
    // Relabelled by rung 2, so the accountant can still tell them apart.
    expect(createCalls(callTool)[0].displayName).toBe('John Smith (our.john@example.com)')
  })

  it('row 3 via the fault - a 6240 winner with a different email is relabelled', async () => {
    const seen: string[] = []
    const callTool = vi.fn(async (toolId: string, inputs: any) => {
      if (toolId === 'find_quickbooks_customer') {
        if (inputs.email) return NOT_FOUND
        if (inputs.displayName === 'John Smith' && seen.includes('John Smith')) {
          return found({ customerId: '300', email: 'stranger@example.com' })
        }
        return NOT_FOUND
      }
      seen.push(inputs.displayName)
      if (inputs.displayName === 'John Smith') throw duplicateNameFault()
      return { customerId: '302', displayName: inputs.displayName }
    })

    const result = await run(callTool, {
      firstName: 'John',
      lastName: 'Smith',
      primaryEmail: 'our.john@example.com',
    })

    expect(result).toBe('302')
    expect(seen).toEqual(['John Smith', 'John Smith (our.john@example.com)'])
  })

  it('🛑 row 4 - REFUSES a same-named customer with no email and no stamp', async () => {
    // §6 acceptance 5. A customer the firm typed in by hand, with a common name
    // and no email, cannot be told apart from a stranger by anything we hold.
    // Guessing is the whole problem, so this stays a refusal.
    const callTool = router({
      byName: { 'John Smith': found({ customerId: '400', displayName: 'John Smith' }) },
    })

    await expect(run(callTool, { firstName: 'John', lastName: 'Smith' })).rejects.toThrow(
      /no email address and no mark from auxx/
    )
    expect(createCalls(callTool)).toHaveLength(0)
  })
})

describe('the label ladder (§2.6)', () => {
  it('uses the email rung when there is an email', async () => {
    const callTool = router({
      byName: { 'Jane Doe': found({ customerId: '1', email: 'someone.else@example.com' }) },
      create: (inputs: any) => ({ customerId: '500', displayName: inputs.displayName }),
    })

    await run(callTool, { firstName: 'Jane', lastName: 'Doe', primaryEmail: 'jane@example.com' })

    expect(createCalls(callTool)[0].displayName).toBe('Jane Doe (jane@example.com)')
  })

  it('uses the company rung when there is no email', async () => {
    const callTool = router({
      byName: { 'Jane Doe': found({ customerId: '1', email: 'someone.else@example.com' }) },
      create: (inputs: any) => ({ customerId: '501', displayName: inputs.displayName }),
    })

    await run(callTool, { firstName: 'Jane', lastName: 'Doe', companyName: 'Acme' })

    expect(createCalls(callTool)[0].displayName).toBe('Jane Doe (Acme)')
  })

  it('falls back to the contact id, which is a pure function of the CONTACT', async () => {
    // Never a counter. `John Smith 2` would depend on who exported first, so
    // the name would not be reproducible and find-by-name would hunt a string
    // only one particular ordering could have produced.
    const callTool = router({
      byName: { 'Jane Doe': found({ customerId: '1', email: 'someone.else@example.com' }) },
      create: (inputs: any) => ({ customerId: '502', displayName: inputs.displayName }),
    })

    await run(callTool, { firstName: 'Jane', lastName: 'Doe' })

    expect(createCalls(callTool)[0].displayName).toBe(`Jane Doe (${CONTACT_ID.slice(-6)})`)
  })

  it('uses the email alone as the label when there is no name', async () => {
    const callTool = router({})

    await run(callTool, { primaryEmail: 'jane@example.com' })

    expect(createCalls(callTool)[0].displayName).toBe('jane@example.com')
  })

  it('terminates rather than looping when every rung is taken', async () => {
    const callTool = router({
      byName: {
        'Jane Doe': found({ customerId: '1', email: 'a@x.com' }),
        'Jane Doe (jane@example.com)': found({ customerId: '2', email: 'b@x.com' }),
        [`Jane Doe (${CONTACT_ID.slice(-6)})`]: found({ customerId: '3', email: 'c@x.com' }),
      },
    })

    await expect(
      run(callTool, { firstName: 'Jane', lastName: 'Doe', primaryEmail: 'jane@example.com' })
    ).rejects.toThrow(/Every name auxx could give this contact/)
    expect(createCalls(callTool)).toHaveLength(0)
  })
})

describe('refusals', () => {
  it('refuses a contact with neither a name nor an email (§4.6)', async () => {
    const callTool = vi.fn()

    await expect(run(callTool, {})).rejects.toThrow(/has no name and no email/)
    expect(callTool).not.toHaveBeenCalled()
  })

  it('refuses a deactivated customer rather than reactivating it (§4.2)', async () => {
    // QuickBooks does not hard-delete a customer, it deactivates one, and it
    // rejects a receivable line naming an inactive customer. Reactivating would
    // be an edit to their books nobody asked for.
    const callTool = router({
      byEmail: {
        'jane@example.com': found({ customerId: '600', displayName: 'Jane Doe', active: false }),
      },
    })

    await expect(
      run(callTool, { firstName: 'Jane', lastName: 'Doe', primaryEmail: 'jane@example.com' })
    ).rejects.toThrow(/has been made inactive/)
    expect(createCalls(callTool)).toHaveLength(0)
    expect(writeQuickbooksIdField).not.toHaveBeenCalled()
  })

  it('rethrows a non-6240 create failure as itself', async () => {
    const callTool = router({
      create: () => {
        throw new Error('QuickBooks is unreachable')
      },
    })

    await expect(run(callTool, { firstName: 'Jane', lastName: 'Doe' })).rejects.toThrow(
      /unreachable/
    )
  })
})

describe('readQuickbooksCustomerFields resolves by systemAttribute (§the near-miss)', () => {
  it('names the attributes the contact registry actually declares', async () => {
    // 🛑 The guard on the bug this nearly shipped with. `FieldValue.fieldId`
    // holds the org's generated `CustomField` id, NOT the registry key - a
    // field's registry `id` is a brand cast over a plain string and the two are
    // unrelated. Joining on the key returns zero rows, which would make every
    // contact look nameless and refuse its own export, silently.
    //
    // The module derives these from `CONTACT_FIELDS` so they cannot drift; this
    // asserts the registry still declares what the SQL is written against.
    const { CONTACT_FIELDS } = await import('../../../resources/registry/resources/contact-fields')

    expect(CONTACT_FIELDS.firstName?.systemAttribute).toBe('first_name')
    expect(CONTACT_FIELDS.lastName?.systemAttribute).toBe('last_name')
    expect(CONTACT_FIELDS.primaryEmail?.systemAttribute).toBe('primary_email')
    expect(CONTACT_FIELDS.company?.systemAttribute).toBe('contact_company')
  })
})
