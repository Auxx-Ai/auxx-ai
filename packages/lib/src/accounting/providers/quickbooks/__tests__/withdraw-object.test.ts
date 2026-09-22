// packages/lib/src/accounting/providers/quickbooks/__tests__/withdraw-object.test.ts
//
// `withdrawObject` is the one method on the seam that REMOVES something
// (brief 60 §5.3), so what is exercised here is the three answers a caller has
// to be able to tell apart: it is gone because we removed it, it is gone
// because it already was, and it is still there and here is whose refusal that
// is.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The batch pins its destination; `withdrawObject` resolves that connection.
vi.mock('../../book-connections', () => ({
  readPinnedAccountingConnection: async () => ({
    connectionId: 'conn1',
    bookId: 'book1',
    credentialId: 'cred1',
    companyId: 'realm1',
    providerKey: 'quickbooks',
    appInstallationId: 'install1',
  }),
}))

const resolveQuickbooksContext = vi.fn()
vi.mock('../invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: (...a: unknown[]) => resolveQuickbooksContext(...a),
}))

import { NONE_ACCOUNTING_PROVIDER } from '../../provider'
import { QuickbooksAccountingProvider } from '../quickbooks-accounting-provider'

const ORG_ID = 'org1'

/** The delete tool as a deployed catalog entry advertises it. */
const DELETE_TOOL = {
  id: 'delete_quickbooks_journal_entry',
  inputsJsonSchema: { properties: { journalEntryId: {}, syncToken: {} } },
}

function connect(
  answer: (inputs: any) => unknown,
  options: { tools?: unknown[] } = {}
): ReturnType<typeof vi.fn> {
  const callTool = vi.fn(async (_toolId: string, inputs: any) => answer(inputs))
  resolveQuickbooksContext.mockResolvedValue({
    connected: true,
    context: {
      organizationId: ORG_ID,
      installationId: 'install1',
      connectionId: 'conn1',
      userId: 'user1',
      realmId: 'realm1',
      tools: options.tools ?? [DELETE_TOOL],
      callTool,
      accountMap: async () => new Map(),
    },
  })
  return callTool
}

const provider = new QuickbooksAccountingProvider()

const CTX = { organizationId: ORG_ID, connectionId: 'conn1' }
const JOURNAL = { objectType: 'journal' as const, externalId: '184' }

beforeEach(() => vi.clearAllMocks())

describe('QuickbooksAccountingProvider.withdrawObject', () => {
  it('sends the recorded id and sync token, and reports the removal', async () => {
    const callTool = connect(() => ({
      journalEntryId: '184',
      status: 'Deleted',
      alreadyGone: false,
    }))

    const result = await provider.withdrawObject(CTX, { ...JOURNAL, remoteVersion: '3' })

    expect(callTool).toHaveBeenCalledWith('delete_quickbooks_journal_entry', {
      journalEntryId: '184',
      syncToken: '3',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'withdrawn',
      externalId: '184',
      providerId: 'quickbooks',
    })
  })

  it('converges on already_gone rather than failing when QuickBooks no longer holds it', async () => {
    connect(() => ({ journalEntryId: '184', status: 'NotFound', alreadyGone: true }))

    const result = await provider.withdrawObject(CTX, { ...JOURNAL, remoteVersion: '3' })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('already_gone')
  })

  it("carries the provider's own refusal verbatim", async () => {
    connect(() => {
      throw new Error(
        'QuickBooks refused the delete: journal entry 184 has changed since syncToken 3 was read. Stale Object Error'
      )
    })

    const result = await provider.withdrawObject(CTX, { ...JOURNAL, remoteVersion: '3' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe(
      'QuickBooks refused the delete: journal entry 184 has changed since syncToken 3 was read. Stale Object Error'
    )
  })

  it('refuses by name when the installed deployment has no delete tool yet', async () => {
    const callTool = connect(() => ({}), { tools: [] })

    const result = await provider.withdrawObject(CTX, { ...JOURNAL, remoteVersion: '3' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('delete_quickbooks_journal_entry')
    expect(result._unsafeUnwrapErr().message).toContain('update the app deployment')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('refuses without a recorded remote version, because QuickBooks needs one', async () => {
    const callTool = connect(() => ({}))

    const result = await provider.withdrawObject(CTX, { ...JOURNAL, remoteVersion: null })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('no recorded version')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('refuses an object type this adapter has no handler for', async () => {
    const callTool = connect(() => ({}))

    const result = await provider.withdrawObject(CTX, {
      ...JOURNAL,
      objectType: 'nonsense',
      remoteVersion: '3',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain("cannot remove a QuickBooks 'nonsense'")
    expect(callTool).not.toHaveBeenCalled()
  })

  // Plan 67 §5.1: every native object dispatches to its own file now. An
  // invoice with the deployment still only carrying the journal's delete
  // tool refuses BY NAME rather than with the old blanket "only journal
  // entries" sentence.
  it('refuses a native object type the installed deployment cannot delete yet', async () => {
    const callTool = connect(() => ({}))

    const result = await provider.withdrawObject(CTX, {
      ...JOURNAL,
      objectType: 'invoice',
      remoteVersion: '3',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('delete_quickbooks_invoice')
    expect(result._unsafeUnwrapErr().message).toContain('update the app deployment')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('refuses when QuickBooks is not connected', async () => {
    resolveQuickbooksContext.mockResolvedValue({ connected: false })

    const result = await provider.withdrawObject(CTX, { ...JOURNAL, remoteVersion: '3' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('QuickBooks is not connected')
  })
})

describe('NONE_ACCOUNTING_PROVIDER.withdrawObject', () => {
  // 🛑 A refusal, not an `already_gone`: with nothing connected we do not know
  // the object is gone, and saying so would let a caller reset a row whose copy
  // still sits in somebody's books.
  it('refuses, the way every other write on the null provider does', async () => {
    const result = await NONE_ACCOUNTING_PROVIDER.withdrawObject(CTX, {
      objectType: 'journal',
      externalId: '184',
      remoteVersion: '3',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe(
      'No accounting system is connected, so there is nothing to remove from one.'
    )
  })
})
