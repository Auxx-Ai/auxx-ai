// packages/lib/src/postings/__tests__/release-exports-for-sync.int.test.ts
//
// The sync queue's release, against real PostgreSQL
// (plans/accounting/tasks/53-two-modes-one-ledger.md §7.2).
//
// ## Why this file exists separately from the unit test
//
// `release-exports-for-sync.test.ts` mocks `../delivery` and so proves the
// BRANCH TABLE - which of five things each posting in a selection is. It proves
// nothing about the write, and **the write is the entire mechanism this unit
// adds**: `AccountingDelivery.releasedAt` is the one column standing between a
// held journal and the provider (`delivery.ts:430`), so a version of this that
// planned a delivery but never stamped it would pass every unit test and ship a
// Sync button that does nothing at all.
//
// So this proves the round trip end to end, in order:
//
//   1. a `manual` acceptance rests UNRELEASED and `pending`, having sent nothing
//   2. `releaseExportsForSync` stamps `releasedAt` and still sends nothing
//   3. the ORDINARY worker call - no `manual` flag - now exports it
//
// Step 3 is the load-bearing one. It is the same call the delivery job makes,
// and before step 2 it refuses; the only thing that changed between the two runs
// is the column this unit writes.
//
// Run: npx vitest run --config vitest.integration.config.ts src/postings/__tests__/release-exports-for-sync.int.test.ts

import { schema, type Transaction } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
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

// The enqueue half. `enqueueAccountingDelivery` reaches the queue through a
// DYNAMIC import and swallows its own failures by design, so without this the
// release would still pass while quietly logging "could not enqueue" - and the
// assertion that the worker is woken would be untestable rather than merely
// untested.
const queue = vi.hoisted(() => ({
  // Typed to the real call shape so `mock.calls[n][2]` is the JOB OPTIONS
  // rather than `never` - the `jobId` assertion below is the whole reason this
  // mock exists, and an untyped `vi.fn()` makes it unwritable.
  add: vi.fn(
    async (
      _name: string,
      _data: { organizationId: string; glPostingId: string },
      _options: { jobId: string }
    ) => ({ id: 'job-1' })
  ),
}))
vi.mock('../../jobs/queues', () => ({
  getQueue: () => queue,
  Queues: { accountingDeliveryQueue: 'accounting-delivery' },
}))

import { resolveQuickbooksContext } from '../../money/quickbooks/invoke-quickbooks-tool'
import { prepareQuickbooksJournal } from '../../money/quickbooks/quickbooks-accounting-provider'
import { acceptEntryInTx, type PreparedEffectMember } from '../accept-entry'
import { readPinnedAccountingConnection } from '../book-connections'
import { deliverAccountingPosting } from '../delivery'
import { captureFulfillmentWorkInTx } from '../effect-work'
import { releaseExportsForSync } from '../retry-export'
import type { BuiltEntry, PostEntryInput } from '../types'
import { listFailedExports } from '../verify-balance'
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

function entry(members: Member[]): BuiltEntry {
  return {
    postingType: 'fulfillment',
    periodKey: '2026-09-14',
    txnDate: '2026-09-14',
    totalDebit: members.length * 100,
    totalCredit: members.length * 100,
    lines: members.flatMap((value, i) =>
      value.acceptedBasis.contribution.map((line, j) => ({
        glAccountId: line.glAccountId,
        direction: line.direction,
        amount: Number(line.amountMinor),
        sourceType: 'fulfillment',
        sourceId: value.acceptedBasis.calculation.fulfillmentInstanceId,
        sortOrder: i * 2 + j,
        dimensions: line.dimensions,
        ...(line.counterpartyType
          ? { counterpartyType: line.counterpartyType, counterpartyId: line.counterpartyId! }
          : {}),
      }))
    ),
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
      organizationId: organizationId,
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
const callTool = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  remote = []
  createCount = 0
  vi.mocked(prepareQuickbooksJournal).mockImplementation(async (_ctx, value: PostEntryInput) => ({
    toolInput: {
      txnDate: value.txnDate,
      docNumber: value.docNumber,
      privateNote: `auxx:${value.glPostingId}`,
      requestId: value.idempotencyKey,
      currency: 'USD',
      lines: value.lines.map((l) => ({
        accountId: l.glAccountId,
        postingType: l.direction === 'debit' ? 'Debit' : 'Credit',
        amountMinor: l.amount,
      })),
    },
    mappingBasis: { fixture: true },
  }))
  callTool.mockImplementation(async (toolId: string, payload: Record<string, unknown>) => {
    if (toolId === 'find_quickbooks_journal_entry') return { journalEntries: remote }
    if (toolId !== 'create_quickbooks_journal_entry') throw new Error('Unexpected tool')
    createCount++
    const found = {
      ...payload,
      journalEntryId: 'remote-1',
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

/** One accepted fulfillment journal, pinned MANUAL - the hold's resting state. */
async function heldPosting() {
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

  const result = await db().transaction((tx) =>
    acceptEntryInTx(
      tx,
      {
        organizationId,
        actorUserId: userId,
        members: [memberValue],
        entry: entry([memberValue]),
        deliveryIntent: { kind: 'manual', connectionId: destination.id },
      },
      {
        revalidateMemberInTx: vi.fn(async (_tx: Transaction, work: { id: string }) => {
          if (work.id !== memberValue.workId) throw new Error('Missing fixture member')
          return memberValue.acceptedBasis
        }),
      }
    )
  )
  if (result.status !== 'accepted' || !result.glPostingId)
    throw new Error('Fixture acceptance failed')
  return { glPostingId: result.glPostingId, bookId: destination.bookId }
}

const readDelivery = async (glPostingId: string) =>
  (
    await db()
      .select()
      .from(schema.AccountingDelivery)
      .where(
        and(
          eq(schema.AccountingDelivery.organizationId, organizationId),
          eq(schema.AccountingDelivery.glPostingId, glPostingId)
        )
      )
      .limit(1)
  )[0]

const readPosting = async (glPostingId: string) =>
  (
    await db().select().from(schema.GlPosting).where(eq(schema.GlPosting.id, glPostingId)).limit(1)
  )[0]!

describe('releasing held exports against PostgreSQL', () => {
  it('stamps releasedAt and wakes the worker, without touching the provider', async () => {
    const { glPostingId } = await heldPosting()

    // ── 1. The hold. ────────────────────────────────────────────────────────
    // The worker's ORDINARY call - no `manual` - on an unreleased delivery.
    const beforeRelease = await deliverAccountingPosting(db(), { organizationId, glPostingId })
    expect(beforeRelease.exportStatus).toBe('pending')
    expect(createCount).toBe(0)
    expect((await readDelivery(glPostingId))?.releasedAt).toBeNull()

    // ── 2. The release. ─────────────────────────────────────────────────────
    const released = await releaseExportsForSync(db(), {
      organizationId,
      glPostingIds: [glPostingId],
    })
    expect(released._unsafeUnwrap()).toMatchObject({ released: 1, skipped: 0, failed: 0 })

    // 🛑 THE assertion this file exists for.
    const delivery = await readDelivery(glPostingId)
    expect(delivery?.releasedAt).toBeInstanceOf(Date)

    // Released is not sent. Nothing reached the provider, and the books still
    // say the copy is outstanding.
    expect(createCount).toBe(0)
    expect((await readPosting(glPostingId)).exportStatus).toBe('pending')
    expect(queue.add).toHaveBeenCalledWith(
      'accounting-delivery',
      { organizationId, glPostingId },
      expect.objectContaining({ jobId: `accounting-delivery:${organizationId}:${glPostingId}` })
    )

    // ── 3. The proof that the stamp is what unblocks it. ────────────────────
    // Byte for byte the call from step 1, which refused. The only thing that
    // changed is the column step 2 wrote.
    const afterRelease = await deliverAccountingPosting(db(), { organizationId, glPostingId })
    expect(afterRelease.exportStatus).toBe('exported')
    expect(createCount).toBe(1)
    expect((await readPosting(glPostingId)).exportStatus).toBe('exported')
  })

  it('shows the release on the queue read the panel actually renders', async () => {
    const { glPostingId } = await heldPosting()
    await deliverAccountingPosting(db(), { organizationId, glPostingId })

    // Held: `listFailedExports` must report it as `pending` and UNRELEASED, or
    // `syncQueueState` puts it in the wrong tab and the Sync button disappears
    // from the only row that needs one.
    const held = (await listFailedExports(db(), organizationId))._unsafeUnwrap()
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({
      glPostingId,
      exportStatus: 'pending',
      deliveryIntent: 'manual',
      releasedAt: null,
      deliveryState: 'pending',
    })

    await releaseExportsForSync(db(), { organizationId, glPostingIds: [glPostingId] })

    const sending = (await listFailedExports(db(), organizationId))._unsafeUnwrap()
    expect(sending).toHaveLength(1)
    expect(sending[0]?.releasedAt).toEqual(expect.any(String))
    // Still one row, not two: the delivery LEFT JOIN must not fan the posting out.
    expect(sending.filter((row) => row.glPostingId === glPostingId)).toHaveLength(1)
  })

  it('is idempotent - a second press does not re-stamp or re-enqueue a new job', async () => {
    const { glPostingId } = await heldPosting()
    await releaseExportsForSync(db(), { organizationId, glPostingIds: [glPostingId] })
    const first = (await readDelivery(glPostingId))?.releasedAt

    const again = await releaseExportsForSync(db(), {
      organizationId,
      glPostingIds: [glPostingId],
    })

    expect(again._unsafeUnwrap()).toMatchObject({ released: 1, failed: 0 })
    // The ORIGINAL stamp survives. It is the moment somebody asked for this to
    // be sent, and a second press is not a second asking.
    expect((await readDelivery(glPostingId))?.releasedAt).toEqual(first)
    // Same `jobId` both times, so BullMQ collapses them onto one job rather
    // than racing a second export against the first one's lease.
    expect(queue.add).toHaveBeenCalledTimes(2)
    for (const call of queue.add.mock.calls)
      expect(call[2].jobId).toBe(`accounting-delivery:${organizationId}:${glPostingId}`)
    expect(createCount).toBe(0)
  })
})
