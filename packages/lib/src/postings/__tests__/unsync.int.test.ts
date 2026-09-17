// packages/lib/src/postings/__tests__/unsync.int.test.ts
//
// Acceptance 1-5 and 7 of plans/accounting/tasks/60-un-syncing-from-the-provider.md
// §10, against real PostgreSQL.
//
// 🔑 Un-sync is an EXPORT operation, not a ledger operation. The assertion that
// `AccountingEffect`, `AccountingDeliveryCoverage` and `AccountingWork` are
// byte-identical before and after is E3, and it is the one this file exists for:
// every other property here could be restored by hand, and that one could not.

import { schema, type Transaction } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../cache', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  onCacheEvent: vi.fn(),
}))
vi.mock('../book-connections', () => ({ readPinnedAccountingConnection: vi.fn() }))
vi.mock('../../money/quickbooks/invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: vi.fn(),
}))
vi.mock('../../money/quickbooks/quickbooks-accounting-provider', () => ({
  prepareQuickbooksJournal: vi.fn(),
}))

import { resolveQuickbooksContext } from '../../money/quickbooks/invoke-quickbooks-tool'
import { prepareQuickbooksJournal } from '../../money/quickbooks/quickbooks-accounting-provider'
import { acceptEntryInTx, type PreparedEffectMember } from '../accept-entry'
import { readPinnedAccountingConnection } from '../book-connections'
import { deliverAccountingPosting, sweepAccountingDeliveries } from '../delivery'
import { captureFulfillmentWorkInTx } from '../effect-work'
import {
  __resetAccountingProvidersForTests,
  registerAccountingProvider,
  setConnectedProviderResolver,
} from '../provider'
import type { BuiltEntry, PostEntryInput } from '../types'
import { unsyncExports } from '../unsync'
import { acceptedBasis, readyBasis } from './fixtures/accounting-effect-basis'

const db = () => getTestDb()
let organizationId: string
let userId: string
let definitionId: string
let clearingId: string
let revenueId: string

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  userId = (await createTestUser()).id
  const definitions = await db()
    .insert(schema.EntityDefinition)
    .values([
      {
        organizationId,
        apiSlug: 'fulfillments',
        singular: 'Fulfillment',
        plural: 'Fulfillments',
        entityType: 'fulfillment',
      },
      {
        organizationId,
        apiSlug: 'gl_accounts',
        singular: 'Account',
        plural: 'Accounts',
        entityType: 'gl_account',
      },
    ])
    .returning()
  definitionId = definitions[0]!.id
  const accountDefinitionId = definitions[1]!.id
  const fields = await db()
    .insert(schema.CustomField)
    .values([
      {
        organizationId,
        entityDefinitionId: accountDefinitionId,
        name: 'Code',
        type: 'TEXT',
        systemAttribute: 'gl_account_code',
        updatedAt: new Date(),
      },
      {
        organizationId,
        entityDefinitionId: accountDefinitionId,
        name: 'Type',
        type: 'SINGLE_SELECT',
        systemAttribute: 'gl_account_type',
        updatedAt: new Date(),
      },
    ])
    .returning()
  const accounts = await db()
    .insert(schema.EntityInstance)
    .values([
      { organizationId, entityDefinitionId: accountDefinitionId, updatedAt: new Date() },
      { organizationId, entityDefinitionId: accountDefinitionId, updatedAt: new Date() },
    ])
    .returning()
  clearingId = accounts[0]!.id
  revenueId = accounts[1]!.id
  await db()
    .insert(schema.FieldValue)
    .values(
      accounts.flatMap((account, i) => [
        {
          organizationId,
          entityId: account.id,
          entityDefinitionId: accountDefinitionId,
          fieldId: fields[0]!.id,
          valueText: i === 0 ? '1100' : '4000',
          sortKey: 'a0',
        },
        {
          organizationId,
          entityId: account.id,
          entityDefinitionId: accountDefinitionId,
          fieldId: fields[1]!.id,
          optionId: i === 0 ? 'asset' : 'revenue',
          sortKey: 'a0',
        },
      ])
    )
})

async function member(): Promise<PreparedEffectMember> {
  const [source] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId, entityDefinitionId: definitionId, updatedAt: new Date() })
    .returning()
  const id = source!.id
  const { work } = await db().transaction((tx) =>
    captureFulfillmentWorkInTx(tx, {
      organizationId,
      fulfillmentInstanceId: id,
      eligibility: 'manual',
      basis: readyBasis(id),
    })
  )
  const basis = acceptedBasis(id)
  for (const line of basis.contribution)
    line.glAccountId = line.direction === 'debit' ? clearingId : revenueId
  for (const line of basis.accountResolution) {
    line.glAccountId = line.lineKey === 'clearing' ? clearingId : revenueId
    line.selectedBy = 'document'
  }
  return { workId: work.id, expectedBasisVersion: 1, acceptedBasis: basis }
}
type Member = Awaited<ReturnType<typeof member>>
type Input = Parameters<typeof acceptEntryInTx>[1]

function entry(members: Member[]): BuiltEntry {
  return {
    postingType: 'fulfillment',
    periodKey: '2026-09-14',
    txnDate: '2026-09-14',
    totalDebit: members.length * 100,
    totalCredit: members.length * 100,
    lines: members.flatMap((member, i) =>
      member.acceptedBasis.contribution.map((line, j) => ({
        glAccountId: line.glAccountId,
        direction: line.direction,
        amount: Number(line.amountMinor),
        sourceType: 'fulfillment',
        sourceId: member.acceptedBasis.calculation.fulfillmentInstanceId,
        sortOrder: i * 2 + j,
        dimensions: line.dimensions,
        ...(line.counterpartyType
          ? { counterpartyType: line.counterpartyType, counterpartyId: line.counterpartyId! }
          : {}),
      }))
    ),
  }
}
function dependencies(members: Member[]) {
  return {
    revalidateMemberInTx: vi.fn(async (_tx: Transaction, work: { id: string }) => {
      const found = members.find((member) => member.workId === work.id)
      if (!found) throw new Error('Missing fixture member')
      return found.acceptedBasis
    }),
  }
}
async function connection() {
  const [book] = await db()
    .insert(schema.ExternalAccountingBook)
    .values({
      organizationId,
      providerKey: 'quickbooks',
      externalCompanyId: `company-${organizationId}`,
    })
    .returning()
  const [credential] = await db()
    .insert(schema.Credential)
    .values({
      organizationId,
      kind: 'app',
      name: 'Fixture authorization',
      encryptedSecrets: 'fixture-only-no-token',
      updatedAt: new Date(),
    })
    .returning()
  const [saved] = await db()
    .insert(schema.ExternalBookConnection)
    .values({
      organizationId,
      bookId: book!.id,
      epoch: 1,
      credentialId: credential!.id,
      credentialOrganizationId: organizationId,
      credentialBindingSnapshot: 'fixture-credential',
      state: 'active',
      exportFromDate: '2026-01-01',
      openingPolicy: { version: 1, mode: 'from_date' },
    })
    .returning()
  return saved!
}

let remote: Record<string, unknown>[]
let createCount: number
/** What the stub provider was asked to remove, in order. */
let withdrawals: { externalId: string; remoteVersion: string | null }[]
/** Set to make the delete's outcome unknown - it lands, the answer does not (§2.4). */
let withdrawTimesOut: boolean
const callTool = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  remote = []
  createCount = 0
  withdrawals = []
  withdrawTimesOut = false

  __resetAccountingProvidersForTests()
  registerAccountingProvider(
    'quickbooks',
    async () =>
      ({
        id: 'quickbooks',
        withdrawObject: async (input: { externalId: string; remoteVersion: string | null }) => {
          withdrawals.push({ externalId: input.externalId, remoteVersion: input.remoteVersion })
          remote = remote.filter((entry) => entry.journalEntryId !== input.externalId)
          if (withdrawTimesOut) throw new Error('Response timeout')
          return ok({ status: 'withdrawn', externalId: input.externalId, providerId: 'quickbooks' })
        },
        // Nothing else on the interface is reachable from `unsyncExports`.
      }) as never
  )
  setConnectedProviderResolver(async () => 'quickbooks')

  vi.mocked(prepareQuickbooksJournal).mockImplementation(async (_ctx, input: PostEntryInput) => ({
    toolInput: {
      txnDate: input.txnDate,
      docNumber: input.docNumber,
      privateNote: `auxx:${input.glPostingId}`,
      requestId: input.idempotencyKey,
      currency: 'USD',
      lines: input.lines.map((l) => ({
        accountId: l.glAccountId,
        postingType: l.direction === 'debit' ? 'Debit' : 'Credit',
        amountMinor: l.amount,
      })),
    },
    mappingBasis: { fixture: true },
  }))
  callTool.mockImplementation(async (toolId: string, payload: Record<string, unknown>) => {
    if (toolId === 'find_quickbooks_journal_entry')
      return { journalEntries: remote.filter((entry) => entry.docNumber === payload.docNumber) }
    if (toolId !== 'create_quickbooks_journal_entry') throw new Error('Unexpected tool')
    createCount++
    const found = {
      ...payload,
      journalEntryId: `remote-${createCount}`,
      syncToken: '0',
      lines: (payload.lines as Array<Record<string, unknown>>).map((l) => ({
        ...l,
        entityType: null,
        entityId: null,
      })),
    }
    remote.push(found)
    return { journalEntry: found }
  })
})

/** One accepted, delivered posting - the state un-sync starts from. */
async function delivered(intent: 'automatic' | 'manual' = 'automatic') {
  const memberValue = await member()
  const destination = await connection()
  vi.mocked(readPinnedAccountingConnection).mockImplementation(async () => ({
    connectionId: destination.id,
    bookId: destination.bookId,
    credentialId: destination.credentialId!,
    companyId: `company-${organizationId}`,
    providerKey: 'quickbooks',
    appInstallationId: 'installation',
  }))
  vi.mocked(resolveQuickbooksContext).mockResolvedValue({
    connected: true,
    context: {
      organizationId,
      installationId: 'installation',
      connectionId: destination.credentialId!,
      realmId: `company-${organizationId}`,
      userId,
      serverBundleSha: 'frozen-bundle',
      tools: [
        {
          id: 'find_quickbooks_journal_entry',
          outputsJsonSchema: {
            properties: {
              journalEntries: {
                items: {
                  properties: Object.fromEntries(
                    [
                      'journalEntryId',
                      'docNumber',
                      'txnDate',
                      'currency',
                      'lines',
                      'privateNote',
                      'syncToken',
                    ].map((key) => [key, {}])
                  ),
                },
              },
            },
          },
        },
        {
          id: 'create_quickbooks_journal_entry',
          inputsJsonSchema: { properties: { requestId: {}, currency: {} } },
        },
      ] as never,
      callTool,
    },
  })
  const accepted = await db().transaction((tx) =>
    acceptEntryInTx(
      tx,
      {
        organizationId,
        actorUserId: userId,
        members: [memberValue],
        entry: entry([memberValue]),
        deliveryIntent: { kind: intent, connectionId: destination.id },
      } as Input,
      dependencies([memberValue])
    )
  )
  if (accepted.status !== 'accepted' || !accepted.glPostingId)
    throw new Error('Fixture acceptance failed')
  const fixture = { organizationId, glPostingId: accepted.glPostingId }
  const pushed = await deliverAccountingPosting(db(), { ...fixture, manual: true })
  expect(pushed).toMatchObject({ exportStatus: 'exported' })
  return fixture
}

const posting = async (glPostingId: string) =>
  (await db().select().from(schema.GlPosting).where(eq(schema.GlPosting.id, glPostingId)))[0]!
const operations = () =>
  db()
    .select()
    .from(schema.AccountingDeliveryOperation)
    .orderBy(schema.AccountingDeliveryOperation.operationKey)
/** The ledger's three tables, as one comparable snapshot (E3). */
async function ledger() {
  return {
    effects: await db().select().from(schema.AccountingEffect),
    coverage: await db().select().from(schema.AccountingDeliveryCoverage),
    work: await db().select().from(schema.AccountingWork),
  }
}

describe('un-syncing a delivered journal against PostgreSQL', () => {
  it('removes the provider copy and returns the row to Ready to sync, ledger untouched', async () => {
    const fixture = await delivered()
    const before = await ledger()

    const result = await unsyncExports(db(), {
      organizationId,
      glPostingIds: [fixture.glPostingId],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 1, refused: 0, failed: 0 })
    expect(withdrawals).toEqual([{ externalId: 'remote-1', remoteVersion: '0' }])
    expect(remote).toHaveLength(0)

    // §10.1 and §10.4.
    expect(await posting(fixture.glPostingId)).toMatchObject({
      status: 'posted',
      exportStatus: 'pending',
      providerEntryId: null,
      providerTenantId: null,
      failureReason: null,
      // Which system answered is history - §2.1.
      providerId: 'quickbooks',
      // 🛑 Demoted, or the sweep re-creates what we just deleted (§2.3).
      deliveryIntent: 'manual',
    })

    const [delivery] = await db().select().from(schema.AccountingDelivery)
    expect(delivery).toMatchObject({
      state: 'pending',
      releasedAt: null,
      completedAt: null,
      attemptEpoch: 1,
    })

    const [object] = await db().select().from(schema.ExternalAccountingObject)
    expect(object!.withdrawnAt).not.toBeNull()

    const ops = await operations()
    expect(ops.map((op) => [op.operationKey, op.state])).toEqual([
      ['journal', 'succeeded'],
      ['unsync:1', 'succeeded'],
    ])
    expect(ops.find((op) => op.operationKey === 'unsync:1')!.outcome).toMatchObject({
      status: 'withdrawn',
      externalId: 'remote-1',
    })

    // §10.2. The ledger is not a participant in this operation.
    expect(await ledger()).toEqual(before)
  })

  it('§10.3: pressing Sync re-delivers under a NEW request id and the same document number', async () => {
    const fixture = await delivered()
    const original = await posting(fixture.glPostingId)
    const firstRequestId = (await operations())[0]!.requestId

    await unsyncExports(db(), { organizationId, glPostingIds: [fixture.glPostingId] })
    const resent = await deliverAccountingPosting(db(), { ...fixture, manual: true })

    expect(resent).toMatchObject({ exportStatus: 'exported', providerEntryId: 'remote-2' })
    expect(createCount).toBe(2)
    expect(remote[0]).toMatchObject({ docNumber: original.docNumber })

    const ops = await operations()
    const resend = ops.find((op) => op.operationKey === 'journal:1')!
    // 🛑 §2.2: the posting's own key is Intuit's idempotence key for the create,
    // and reusing it can collapse the re-send onto the original's cached answer.
    expect(resend.requestId).not.toBe(firstRequestId)
    expect(resend.requestId).not.toBe(original.requestId)
    expect(resend.state).toBe('succeeded')
    expect(await db().select().from(schema.ExternalAccountingObject)).toHaveLength(2)
  })

  it('§10.4: the sweep does not re-deliver an un-synced automatic posting', async () => {
    const fixture = await delivered('automatic')

    await unsyncExports(db(), { organizationId, glPostingIds: [fixture.glPostingId] })
    const swept = await sweepAccountingDeliveries(db(), { organizationId })

    expect(swept.examined).toBe(0)
    expect(createCount).toBe(1)
    expect(remote).toHaveLength(0)
  })

  it('§10.5: a delete of unknown outcome leaves the row exported and the operation uncertain', async () => {
    const fixture = await delivered()
    withdrawTimesOut = true

    const result = await unsyncExports(db(), {
      organizationId,
      glPostingIds: [fixture.glPostingId],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 0, failed: 1 })
    expect(result._unsafeUnwrap().outcomes[0]?.status).toBe('uncertain')
    // 🛑 Nothing on the posting moved, because the copy may still be there.
    expect(await posting(fixture.glPostingId)).toMatchObject({
      exportStatus: 'exported',
      providerEntryId: 'remote-1',
      deliveryIntent: 'automatic',
    })
    const [delivery] = await db().select().from(schema.AccountingDelivery)
    expect(delivery).toMatchObject({ state: 'delivered', attemptEpoch: 0 })
    const ops = await operations()
    expect(ops.find((op) => op.operationKey === 'unsync:1')!.state).toBe('uncertain')

    // 🛑 §2.4 claims the sweep picks this up; it does NOT. `sweepAccountingDeliveries`
    // joins only the JOURNAL operation of the current epoch, which is `succeeded`
    // here, so an `unsync:<n>` left uncertain is invisible to it. The recovery is
    // the next test: a repeat of `unsyncExports` resolves it by readback.
    expect((await sweepAccountingDeliveries(db(), { organizationId })).examined).toBe(0)
  })

  it('§10.5 recovery: a repeat resolves the uncertain delete by readback, not by a second delete', async () => {
    const fixture = await delivered()
    withdrawTimesOut = true
    await unsyncExports(db(), { organizationId, glPostingIds: [fixture.glPostingId] })
    expect(withdrawals).toHaveLength(1)

    withdrawTimesOut = false
    const result = await unsyncExports(db(), {
      organizationId,
      glPostingIds: [fixture.glPostingId],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 1 })
    // 🛑 The readback IS the recovery. The delete that timed out had landed, so
    // no second one is sent.
    expect(withdrawals).toHaveLength(1)
    expect(await posting(fixture.glPostingId)).toMatchObject({ exportStatus: 'pending' })
    const ops = await operations()
    expect(ops.find((op) => op.operationKey === 'unsync:1')!.state).toBe('succeeded')
  })

  it('§10.7: refuses a reversed entry, naming its reversal, and removes nothing', async () => {
    const fixture = await delivered()
    const original = await posting(fixture.glPostingId)
    await db()
      .insert(schema.GlPosting)
      .values({
        organizationId,
        postingType: original.postingType,
        periodKey: original.periodKey,
        revision: 1,
        txnDate: original.txnDate,
        docNumber: `${original.docNumber}-R1`,
        totalMinor: original.totalMinor,
        draft: {},
        requestId: `${original.requestId}-r1`,
        reversesId: original.id,
        postedAt: new Date(),
        postedByUserId: userId,
      })
    await db()
      .update(schema.GlPosting)
      .set({ status: 'reversed' })
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.id, original.id)
        )
      )

    const result = await unsyncExports(db(), {
      organizationId,
      glPostingIds: [fixture.glPostingId],
    })

    const outcome = result._unsafeUnwrap().outcomes[0]
    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 0, refused: 1 })
    expect(outcome?.message).toContain(`has been reversed by ${original.docNumber}-R1`)
    expect(withdrawals).toHaveLength(0)
    expect(remote).toHaveLength(1)
    // 🛑 No withdrawal operation is even opened for a refused row.
    expect((await operations()).map((op) => op.operationKey)).toEqual(['journal'])
  })

  it('R1: an entry that was never sent is refused rather than re-read from the provider', async () => {
    const fixture = await delivered('manual')
    await db()
      .update(schema.GlPosting)
      .set({ exportStatus: 'failed' })
      .where(eq(schema.GlPosting.id, fixture.glPostingId))

    const result = await unsyncExports(db(), {
      organizationId,
      glPostingIds: [fixture.glPostingId],
    })

    expect(result._unsafeUnwrap().outcomes[0]?.message).toContain('was never sent')
    expect(withdrawals).toHaveLength(0)
  })
})
