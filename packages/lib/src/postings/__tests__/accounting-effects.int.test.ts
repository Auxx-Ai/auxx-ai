// packages/lib/src/postings/__tests__/accounting-effects.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { toRecordId } from '@auxx/types/resource'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import {
  assertAccountingSourcesMutableInTx,
  withAccountingFieldMutation,
} from '../source-write-guard'

vi.mock('../../cache', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  onCacheEvent: vi.fn(),
}))

import {
  batchUpdateOrganizationSettings,
  updateOrganizationSetting,
} from '../../settings/settings-service'
import { withAccountingCommitLock } from '../accounting-commit-lock'
import { accountingBasisHash } from '../effect-basis'
import {
  appendFulfillmentWorkBasisInTx,
  captureCustomerReceiptWorkInTx,
  captureFulfillmentWorkInTx,
} from '../effect-work'
import { resolvePeriodLock } from '../period-lock'
import { resolveRoles } from '../resolve-roles'
import { setLockedThrough } from '../set-locked-through'
import { acceptedBasis, readyBasis, SOURCE_HASH } from './fixtures/accounting-effect-basis'

const db = () => getTestDb()
let organizationId: string
let fulfillmentId: string
let userId: string

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  userId = (await createTestUser()).id
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      apiSlug: 'fulfillments',
      singular: 'Fulfillment',
      plural: 'Fulfillments',
      entityType: 'fulfillment',
    })
    .returning()
  const [source] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId, entityDefinitionId: def!.id, updatedAt: new Date() })
    .returning()
  fulfillmentId = source!.id
})

function capture() {
  return db().transaction((tx) =>
    captureFulfillmentWorkInTx(tx, {
      organizationId,
      fulfillmentInstanceId: fulfillmentId,
      eligibility: 'manual',
      basis: readyBasis(fulfillmentId),
    })
  )
}
async function posting(extra: Partial<typeof schema.GlPosting.$inferInsert> = {}) {
  const [row] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'fulfillment',
      periodKey: '2026-09-14',
      txnDate: '2026-09-14',
      docNumber: 'foundation-fixture',
      totalMinor: 100,
      draft: {},
      requestId: 'foundation-fixture',
      postedAt: new Date(),
      deliveryIntent: 'not_required',
      ...extra,
    })
    .returning()
  return row!
}
async function acceptFixture() {
  const captured = await capture()
  const journal = await posting()
  const basis = acceptedBasis(fulfillmentId)
  const [effect] = await db()
    .insert(schema.AccountingEffect)
    .values({
      organizationId,
      workId: captured.work.id,
      basisVersion: 1,
      glPostingId: journal.id,
      effectiveDate: '2026-09-14',
      currency: 'USD',
      currencyExponent: 2,
      acceptedBasis: basis,
      basisHash: accountingBasisHash(basis),
    })
    .returning()
  return { captured, journal, effect: effect! }
}

describe('accounting foundation against PostgreSQL', () => {
  it('converges concurrent captures on one original and rolls back incomplete capture', async () => {
    const [a, b] = await Promise.all([capture(), capture()])
    expect(a.work.id).toBe(b.work.id)
    expect([a.existing, b.existing].sort()).toEqual([false, true])
    expect(await db().select().from(schema.AccountingWorkBasis)).toHaveLength(1)
    await expect(
      db()
        .insert(schema.AccountingWork)
        .values({ ...a.work, id: 'duplicate-original', effectKey: 'different-key' })
    ).rejects.toThrow()
    await db().delete(schema.AccountingWorkBasis)
    await db().delete(schema.AccountingWork)
    await expect(
      db().transaction(async (tx) => {
        await captureFulfillmentWorkInTx(tx, {
          organizationId,
          fulfillmentInstanceId: fulfillmentId,
          eligibility: 'manual',
          basis: readyBasis(fulfillmentId),
        })
        throw new Error('simulated crash before commit')
      })
    ).rejects.toThrow('simulated crash')
    expect(await db().select().from(schema.AccountingWork)).toHaveLength(0)
    expect(await db().select().from(schema.AccountingWorkBasis)).toHaveLength(0)
  })

  it('appends pending basis with compare-and-set and repeat response recovery', async () => {
    const { work } = await capture()
    const changed = readyBasis(fulfillmentId)
    changed.calculation.sourceRevision = 'revision2'
    changed.sourceHash = 'b'.repeat(64)
    changed.calculation.sourceHash = changed.sourceHash
    const input = { organizationId, workId: work.id, expectedBasisVersion: 1, basis: changed }
    const saved = await db().transaction((tx) => appendFulfillmentWorkBasisInTx(tx, input))
    expect(saved.version).toBe(2)
    expect((await db().transaction((tx) => appendFulfillmentWorkBasisInTx(tx, input))).id).toBe(
      saved.id
    )
    await expect(
      db().transaction((tx) =>
        appendFulfillmentWorkBasisInTx(tx, { ...input, basis: readyBasis(fulfillmentId) })
      )
    ).rejects.toThrow('changed')
    expect(await db().select().from(schema.AccountingWorkBasis)).toHaveLength(2)
  })

  it('never advances accepted work and rejects a nonexistent pinned version or duplicate effect', async () => {
    const { captured, journal, effect } = await acceptFixture()
    await expect(
      db().transaction((tx) =>
        appendFulfillmentWorkBasisInTx(tx, {
          organizationId,
          workId: captured.work.id,
          expectedBasisVersion: 1,
          basis: readyBasis(fulfillmentId),
        })
      )
    ).rejects.toThrow('Accepted accounting')
    await expect(
      db()
        .insert(schema.AccountingEffect)
        .values({ ...effect, id: 'duplicate' })
    ).rejects.toThrow()
    const { id: _id, ...effectData } = effect
    await db().delete(schema.AccountingEffect)
    await expect(
      db()
        .insert(schema.AccountingEffect)
        .values({ ...effectData, basisVersion: 99 })
    ).rejects.toThrow()
    await db().insert(schema.AccountingEffect).values(effect)
    await expect(
      db().delete(schema.GlPosting).where(eq(schema.GlPosting.id, journal.id))
    ).rejects.toThrow()
    await expect(db().delete(schema.AccountingWorkBasis)).rejects.toThrow()
    await expect(
      db().delete(schema.EntityInstance).where(eq(schema.EntityInstance.id, fulfillmentId))
    ).rejects.toThrow()
  })

  it('rejects cross-org source/work/posting/connection references', async () => {
    const other = (await createTestOrganization()).id
    await expect(
      db().transaction((tx) =>
        captureFulfillmentWorkInTx(tx, {
          organizationId: other,
          fulfillmentInstanceId: fulfillmentId,
          eligibility: 'manual',
          basis: readyBasis(fulfillmentId),
        })
      )
    ).rejects.toThrow('live fulfillment')
    const { work } = await capture()
    await expect(
      db()
        .insert(schema.AccountingWork)
        .values({ ...work, id: 'wrong-org-work', organizationId: other })
    ).rejects.toThrow()
    await expect(
      db()
        .insert(schema.AccountingWorkBasis)
        .values({
          organizationId: other,
          workId: work.id,
          version: 2,
          sourceHash: SOURCE_HASH,
          basis: readyBasis(fulfillmentId),
          effectiveDate: '2026-09-14',
        })
    ).rejects.toThrow()
    const journal = await posting({ organizationId: other })
    await expect(
      db().insert(schema.AccountingEffect).values({
        organizationId,
        workId: work.id,
        basisVersion: 1,
        glPostingId: journal.id,
        effectiveDate: '2026-09-14',
        currency: 'USD',
        currencyExponent: 2,
        acceptedBasis: {},
        basisHash: SOURCE_HASH,
      })
    ).rejects.toThrow()
  })

  it('rejects SQL-null discriminator and delivery-intent bypasses', async () => {
    const { work } = await capture()
    await expect(
      db()
        .insert(schema.AccountingWorkBasis)
        .values({ organizationId, workId: work.id, version: 2, sourceHash: SOURCE_HASH, basis: {} })
    ).rejects.toThrow()
    const [book] = await db()
      .insert(schema.ExternalAccountingBook)
      .values({ organizationId, providerKey: 'quickbooks', externalCompanyId: 'company' })
      .returning()
    const connectionData = {
      organizationId,
      bookId: book!.id,
      epoch: 1,
      credentialBindingSnapshot: 'credential1',
      state: 'disconnected' as const,
      exportFromDate: '2026-09-14',
      openingPolicy: { version: 1, mode: 'from_date' },
    }
    await expect(
      db()
        .insert(schema.ExternalBookConnection)
        .values({ ...connectionData, credentialId: 'credential1', credentialOrganizationId: null })
    ).rejects.toThrow()
    const [connection] = await db()
      .insert(schema.ExternalBookConnection)
      .values(connectionData)
      .returning()
    await expect(
      posting({ deliveryIntent: null, intendedBookConnectionId: connection!.id })
    ).rejects.toThrow()
    const other = (await createTestOrganization()).id
    await expect(
      posting({
        organizationId: other,
        deliveryIntent: 'manual',
        intendedBookConnectionId: connection!.id,
      })
    ).rejects.toThrow()
  })

  it('deletes all accounting children with the organization while preserving another organization', async () => {
    const { journal, effect } = await acceptFixture()
    await db()
      .insert(schema.GlPostingLine)
      .values([
        {
          organizationId,
          glPostingId: journal.id,
          lineNumber: 1,
          glAccountId: 'clearing',
          direction: 'debit',
          amountMinor: 100,
          sourceType: 'fulfillment',
          sourceId: fulfillmentId,
        },
        {
          organizationId,
          glPostingId: journal.id,
          lineNumber: 2,
          glAccountId: 'revenue',
          direction: 'credit',
          amountMinor: 100,
          sourceType: 'fulfillment',
          sourceId: fulfillmentId,
        },
      ])
    await db().insert(schema.AccountingWork).values({
      organizationId,
      entityInstanceId: fulfillmentId,
      effectKind: 'fulfillment_accounting',
      operation: 'correction',
      effectKey: 'correction-fixture',
      correctsEffectId: effect.id,
      componentKey: 'replace',
      basisVersion: 1,
      state: 'pending',
      eligibility: 'manual',
    })
    const other = (await createTestOrganization()).id
    const survivor = await posting({ organizationId: other })
    const [book] = await db()
      .insert(schema.ExternalAccountingBook)
      .values({ organizationId, providerKey: 'quickbooks', externalCompanyId: 'company' })
      .returning()
    const [connection] = await db()
      .insert(schema.ExternalBookConnection)
      .values({
        organizationId,
        bookId: book!.id,
        epoch: 1,
        credentialBindingSnapshot: 'credential',
        state: 'disconnected',
        exportFromDate: '2026-09-14',
        openingPolicy: { version: 1, mode: 'from_date' },
      })
      .returning()
    await db()
      .update(schema.GlPosting)
      .set({ deliveryIntent: 'manual', intendedBookConnectionId: connection!.id })
      .where(eq(schema.GlPosting.id, journal.id))
    await db().delete(schema.Organization).where(eq(schema.Organization.id, organizationId))
    for (const table of [
      schema.AccountingWork,
      schema.AccountingWorkBasis,
      schema.AccountingEffect,
      schema.ExternalAccountingBook,
      schema.ExternalBookConnection,
      schema.GlPostingLine,
    ])
      expect(await db().select().from(table)).toHaveLength(0)
    expect((await db().select().from(schema.GlPosting)).map((row) => row.id)).toEqual([survivor.id])
  })

  it('serializes a period setting command behind the transaction lock and audits atomically', async () => {
    let holderPid = 0
    let release!: () => void
    let acquired!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const first = db().transaction(async (tx) => {
      await withAccountingCommitLock(tx, organizationId)
      holderPid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]?.pid)
      expect(await resolvePeriodLock(organizationId, tx)).toEqual({ lockedThroughMonth: null })
      acquired()
      await hold
    })
    await locked
    const second = setLockedThrough(db(), {
      organizationId,
      periodKey: '2026-08',
      actorUserId: userId,
    })
    try {
      const probe = await db().transaction((tx) =>
        tx.execute(
          sql`select pg_try_advisory_xact_lock(hashtextextended(${'auxx:accounting:' + organizationId}, 0)) as acquired`
        )
      )
      expect(probe.rows[0]?.acquired).toBe(false)
      await vi.waitFor(
        async () => {
          const waiting = await db().execute(
            sql`select count(*)::int as count from pg_locks waiter join pg_locks holder on waiter.locktype = holder.locktype and waiter.classid = holder.classid and waiter.objid = holder.objid and waiter.objsubid = holder.objsubid where holder.pid = ${holderPid} and holder.locktype = 'advisory' and holder.granted and not waiter.granted`
          )
          expect(waiting.rows[0]?.count).toBe(1)
        },
        { timeout: 3000 }
      )
    } finally {
      release()
    }
    await Promise.all([first, second])
    expect(await db().transaction((tx) => resolvePeriodLock(organizationId, tx))).toEqual({
      lockedThroughMonth: '2026-08',
    })
    expect(await db().select().from(schema.AuditLog)).toHaveLength(1)
    await setLockedThrough(db(), { organizationId, periodKey: null, actorUserId: userId })
    expect(await db().transaction((tx) => resolvePeriodLock(organizationId, tx))).toEqual({
      lockedThroughMonth: null,
    })
    await expect(
      setLockedThrough(db(), { organizationId, periodKey: '2026-13', actorUserId: userId })
    ).rejects.toThrow()
    await expect(
      updateOrganizationSetting({
        organizationId,
        key: 'ledger.lockedThroughMonth',
        value: '2026-09',
        db: db(),
      })
    ).rejects.toThrow('setLockedThrough')
    await expect(
      batchUpdateOrganizationSettings({
        organizationId,
        settings: [{ key: 'ledger.lockedThroughMonth', value: '2026-09' }],
        db: db(),
      })
    ).rejects.toThrow('setLockedThrough')
  })

  it('rolls back the period setting when its audit insert fails', async () => {
    // Fault injection belongs only to this disposable test database, never a migration.
    await db().execute(
      sql`alter table "AuditLog" add constraint foundation_audit_failure check (action <> 'setting.changed')`
    )
    try {
      await expect(
        setLockedThrough(db(), { organizationId, periodKey: '2026-08', actorUserId: userId })
      ).rejects.toThrow()
      expect(await db().transaction((tx) => resolvePeriodLock(organizationId, tx))).toEqual({
        lockedThroughMonth: null,
      })
      expect(await db().select().from(schema.AuditLog)).toHaveLength(0)
    } finally {
      await db().execute(sql`alter table "AuditLog" drop constraint foundation_audit_failure`)
    }
  })

  it('reads uncommitted role, account values and field definitions through the supplied transaction', async () => {
    await db().transaction(async (tx) => {
      const [def] = await tx
        .insert(schema.EntityDefinition)
        .values({
          organizationId,
          apiSlug: 'gl_accounts',
          singular: 'Account',
          plural: 'Accounts',
          entityType: 'gl_account',
        })
        .returning()
      const fields = await tx
        .insert(schema.CustomField)
        .values([
          {
            organizationId,
            entityDefinitionId: def!.id,
            name: 'Code',
            type: 'TEXT',
            systemAttribute: 'gl_account_code',
            updatedAt: new Date(),
          },
          {
            organizationId,
            entityDefinitionId: def!.id,
            name: 'Type',
            type: 'SINGLE_SELECT',
            systemAttribute: 'gl_account_type',
            updatedAt: new Date(),
          },
        ])
        .returning()
      const [account] = await tx
        .insert(schema.EntityInstance)
        .values({ organizationId, entityDefinitionId: def!.id, updatedAt: new Date() })
        .returning()
      await tx.insert(schema.FieldValue).values([
        {
          organizationId,
          entityId: account!.id,
          entityDefinitionId: def!.id,
          fieldId: fields[0]!.id,
          valueText: '1000',
          sortKey: 'a0',
        },
        {
          organizationId,
          entityId: account!.id,
          entityDefinitionId: def!.id,
          fieldId: fields[1]!.id,
          optionId: 'asset',
          sortKey: 'a0',
        },
      ])
      await tx.insert(schema.GlRoleAssignment).values({
        organizationId,
        role: 'clearing_card',
        source: 'human',
        glAccountId: account!.id,
        markedUnused: false,
      })
      const result = await resolveRoles(tx, organizationId, ['clearing_card'])
      expect(result.isOk()).toBe(true)
      if (result.isOk()) expect(result.value.get('clearing_card')?.glAccountId).toBe(account!.id)
    })
  })
})

describe('financial source mutation guards', () => {
  it('rejects accepted fulfillment changes before entering the mutation', async () => {
    await acceptFixture()
    const source = await db().query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, fulfillmentId),
    })
    const mutate = vi.fn()
    await expect(
      withAccountingFieldMutation(
        createFieldValueContext(organizationId, userId, db()),
        [
          {
            recordId: toRecordId(source!.entityDefinitionId, fulfillmentId),
            fields: [{ fieldId: 'fulfillment_shipped_at', value: '2026-09-15' }],
            operation: 'set',
          },
        ],
        mutate
      )
    ).rejects.toThrow('correction')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('allows tracking updates after acceptance', async () => {
    await acceptFixture()
    const source = await db().query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, fulfillmentId),
    })
    const mutate = vi.fn(async () => 'updated')
    const result = await withAccountingFieldMutation(
      createFieldValueContext(organizationId, userId, db()),
      [
        {
          recordId: toRecordId(source!.entityDefinitionId, fulfillmentId),
          fields: [{ fieldId: 'fulfillment_tracking_number', value: 'TRACK123' }],
          operation: 'set',
        },
      ],
      mutate
    )
    expect(result).toBe('updated')
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('refuses inserting a child into an already accepted fulfillment', async () => {
    await acceptFixture()
    const [definition] = await db()
      .insert(schema.EntityDefinition)
      .values({
        organizationId,
        entityType: 'fulfillment_line',
        apiSlug: 'fulfillment_lines',
        singular: 'Line',
        plural: 'Lines',
      })
      .returning()
    const [line] = await db()
      .insert(schema.EntityInstance)
      .values({ organizationId, entityDefinitionId: definition!.id, updatedAt: new Date() })
      .returning()
    await expect(
      db().transaction(async (tx) => {
        await withAccountingCommitLock(tx, organizationId)
        await assertAccountingSourcesMutableInTx(
          tx,
          organizationId,
          [toRecordId(definition!.id, line!.id)],
          [fulfillmentId]
        )
      })
    ).rejects.toThrow('correction')
  })

  it('waits for acceptance ownership before deciding source mutability', async () => {
    const source = await db().query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, fulfillmentId),
    })
    let unlock!: () => void
    let acquired!: () => void
    const held = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const release = new Promise<void>((resolve) => {
      unlock = resolve
    })
    const first = db().transaction(async (tx) => {
      await withAccountingCommitLock(tx, organizationId)
      acquired()
      await release
    })
    await held
    let mutated = false
    const write = withAccountingFieldMutation(
      createFieldValueContext(organizationId, userId, db()),
      [
        {
          recordId: toRecordId(source!.entityDefinitionId, fulfillmentId),
          fields: [{ fieldId: 'fulfillment_shipped_at', value: null }],
          operation: 'set',
        },
      ],
      async () => {
        mutated = true
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mutated).toBe(false)
    unlock()
    await first
    await write
    expect(mutated).toBe(true)
  })
})

describe('accepted receipt source protection', () => {
  it('freezes order and line tax evidence before any fulfillment is accepted', async () => {
    const ids: Record<string, string> = {}
    const defs: Record<string, string> = {}
    for (const kind of ['order', 'line_item', 'tax_line']) {
      const [def] = await db()
        .insert(schema.EntityDefinition)
        .values({ organizationId, apiSlug: kind, singular: kind, plural: kind, entityType: kind })
        .returning()
      defs[kind] = def!.id
      const [row] = await db()
        .insert(schema.EntityInstance)
        .values({ organizationId, entityDefinitionId: def!.id, updatedAt: new Date() })
        .returning()
      ids[kind] = row!.id
    }
    for (const kind of ['line_item', 'tax_line']) {
      const [field] = await db()
        .insert(schema.CustomField)
        .values({
          organizationId,
          entityDefinitionId: defs[kind]!,
          name: `${kind}_order`,
          systemAttribute: `${kind}_order`,
          type: 'RELATIONSHIP',
          updatedAt: new Date(),
        })
        .returning()
      await db().insert(schema.FieldValue).values({
        organizationId,
        entityDefinitionId: defs[kind]!,
        entityId: ids[kind]!,
        fieldId: field!.id,
        relatedEntityId: ids.order!,
      })
    }
    const [command] = await db()
      .insert(schema.MoneyCommand)
      .values({
        organizationId,
        commandKey: 'guard-fixture',
        kind: 'import_receipt',
        payloadHash: SOURCE_HASH,
        actorSnapshot: {},
        resultIds: {},
      })
      .returning()
    const [money] = await db()
      .insert(schema.MoneyTransaction)
      .values({
        organizationId,
        purpose: 'customer_receipt',
        amountMinor: 100n,
        currency: 'USD',
        currencyExponent: 2,
        datePrecision: 'instant',
        occurredAt: new Date('2026-09-14T12:00:00Z'),
        recordedByCommandId: command!.id,
      })
      .returning()
    const captured = await db().transaction((tx) =>
      captureCustomerReceiptWorkInTx(tx, {
        organizationId,
        moneyTransactionId: money!.id,
        eligibility: 'manual',
        basis: {
          version: 1,
          status: 'incomplete',
          moneyTransactionId: money!.id,
          sourceHash: SOURCE_HASH,
          effectiveDate: '2026-09-14',
          missingDependencies: ['fixture'],
          observed: {},
        },
      })
    )
    const journal = await posting({ postingType: 'payment' })
    const basis = { calculation: { orderInstanceId: ids.order! } }
    await db()
      .insert(schema.AccountingEffect)
      .values({
        organizationId,
        workId: captured.work.id,
        basisVersion: 1,
        glPostingId: journal.id,
        effectiveDate: '2026-09-14',
        currency: 'USD',
        currencyExponent: 2,
        acceptedBasis: basis,
        basisHash: accountingBasisHash(basis),
      })
    for (const kind of ['order', 'line_item', 'tax_line']) {
      await expect(
        db().transaction((tx) =>
          assertAccountingSourcesMutableInTx(tx, organizationId, [
            toRecordId(defs[kind]!, ids[kind]!),
          ])
        )
      ).rejects.toThrow('accepted payment accounting')
    }
    // A newly recorded shipment may consume this deposit without changing the frozen order.
    await expect(
      db().transaction((tx) =>
        assertAccountingSourcesMutableInTx(tx, organizationId, [
          toRecordId('fulfillment', fulfillmentId),
        ])
      )
    ).resolves.toBeUndefined()
  })
})
