// packages/lib/src/accounting/ledger/periods/__tests__/read-posted-after-review.int.test.ts
//
// 104 P1c: Posted after review, against real AuditLog and GlPosting rows.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readPostedAfterReview } from '../read-posted-after-review'
import { setLockedThrough } from '../set-locked-through'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in posted-after-review database tests')
  },
}))

const db = () => getTestDb() as unknown as Database
const KEY = 'ledger.lockedThroughMonth'

const T1 = new Date('2026-04-05T10:00:00.000Z')
const T2 = new Date('2026-05-05T10:00:00.000Z')
const T3 = new Date('2026-06-05T10:00:00.000Z')
const after = (at: Date, minutes = 1) => new Date(at.getTime() + minutes * 60_000)

let organizationId: string
let docSeq = 0

async function setting(orgId: string, key: string, value: string | null, updatedAt = new Date()) {
  await db()
    .insert(schema.OrganizationSetting)
    .values({ organizationId: orgId, key, value, updatedAt })
    .onConflictDoUpdate({
      target: [schema.OrganizationSetting.organizationId, schema.OrganizationSetting.key],
      set: { value, updatedAt },
    })
}

/** An audit row in `setLockedThrough`'s shape, and the setting it leaves behind. */
async function moveLock(orgId: string, from: string | null, to: string | null, at: Date) {
  await db()
    .insert(schema.AuditLog)
    .values({
      organizationId: orgId,
      category: 'settings',
      action: 'setting.changed',
      targetType: 'OrganizationSetting',
      targetId: KEY,
      actorType: 'user',
      previousState: { value: from },
      newState: { value: to },
      createdAt: at,
    })
  await setting(orgId, KEY, to, at)
}

async function posting(orgId: string, txnDate: string, createdAt: Date) {
  docSeq += 1
  const [row] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId: orgId,
      postingType: 'manual_journal',
      periodKey: `JNL-${docSeq}`,
      txnDate,
      docNumber: `JNL-${String(docSeq).padStart(4, '0')}`,
      totalMinor: 1000 * docSeq,
      built: { v: 1, memo: `entry ${docSeq}` },
      postedAt: createdAt,
      createdAt,
    })
    .returning({ id: schema.GlPosting.id })
  return row!.id
}

async function read(orgId = organizationId, range: { from?: string; to?: string } = {}) {
  const result = await readPostedAfterReview(db(), { organizationId: orgId, ...range })
  if (result.isErr()) throw result.error
  return result.value
}

const ids = (months: Awaited<ReturnType<typeof read>>) =>
  Object.fromEntries(months.map((month) => [month.periodKey, month.entries.map((e) => e.id)]))

beforeEach(async () => {
  const org = await createTestOrganization()
  organizationId = org.id
  await setting(organizationId, 'accounting.cutoffPeriod', '2025-12')
})

describe('readPostedAfterReview', () => {
  it('lists entries created after the review, not before, and never an unreviewed month', async () => {
    await moveLock(organizationId, null, '2026-03', T1)
    await posting(organizationId, '2026-03-10', new Date('2026-03-20T00:00:00.000Z'))
    const late = await posting(organizationId, '2026-03-31', after(T1))
    await posting(organizationId, '2026-04-02', after(T1))

    const months = await read()
    expect(ids(months)).toEqual({ '2026-03': [late] })
    expect(months[0]!.reviewedAt).toBe(T1.toISOString())
    expect(months[0]!.reviewedAtApproximate).toBe(false)
    expect(months[0]!.entries[0]).toMatchObject({ txnDate: '2026-03-31', memo: 'entry 2' })
  })

  it('dates each month from the move that reviewed it', async () => {
    await moveLock(organizationId, null, '2026-01', T1)
    await moveLock(organizationId, '2026-01', '2026-02', T2)
    const janLate = await posting(organizationId, '2026-01-15', after(T1))
    await posting(organizationId, '2026-02-15', after(T1))
    const febLate = await posting(organizationId, '2026-02-20', after(T2))

    expect(ids(await read())).toEqual({ '2026-01': [janLate], '2026-02': [febLate] })
  })

  it('restarts a reopened month from the move that reviewed it again', async () => {
    await moveLock(organizationId, null, '2026-02', T1)
    await moveLock(organizationId, '2026-02', '2026-01', T2)
    await moveLock(organizationId, '2026-01', '2026-02', T3)
    const janLate = await posting(organizationId, '2026-01-15', after(T2))
    await posting(organizationId, '2026-02-15', after(T2))
    const febLate = await posting(organizationId, '2026-02-16', after(T3))

    const months = await read()
    expect(ids(months)).toEqual({ '2026-01': [janLate], '2026-02': [febLate] })
    expect(months[1]!.reviewedAt).toBe(T3.toISOString())
  })

  it("falls back to the setting's updatedAt when no audit row covers the month", async () => {
    await setting(organizationId, KEY, '2026-02', T2)
    await posting(organizationId, '2026-02-01', after(T1))
    const late = await posting(organizationId, '2026-02-02', after(T2))

    const months = await read()
    expect(ids(months)).toEqual({ '2026-02': [late] })
    expect(months[0]!.reviewedAtApproximate).toBe(true)
  })

  it('says nothing with no marker, and nothing at or before the cutoff', async () => {
    await posting(organizationId, '2026-01-15', after(T1))
    expect(await read()).toEqual([])

    await moveLock(organizationId, null, '2025-11', T1)
    await posting(organizationId, '2025-11-15', after(T1))
    expect(await read()).toEqual([])
  })

  it("never lists another organization's entries", async () => {
    const other = (await createTestOrganization()).id
    await setting(other, 'accounting.cutoffPeriod', '2025-12')
    await moveLock(other, null, '2026-03', T1)
    await posting(other, '2026-03-15', after(T1))
    await moveLock(organizationId, null, '2026-03', T2)
    const mine = await posting(organizationId, '2026-03-16', after(T2))

    expect(ids(await read())).toEqual({ '2026-03': [mine] })
  })

  it('narrows to a txnDate range', async () => {
    await moveLock(organizationId, null, '2026-03', T1)
    await posting(organizationId, '2026-01-15', after(T1))
    const feb = await posting(organizationId, '2026-02-15', after(T1))
    await posting(organizationId, '2026-03-15', after(T1))

    expect(ids(await read(organizationId, { from: '2026-02-01', to: '2026-02-28' }))).toEqual({
      '2026-02': [feb],
    })
  })

  it('reads the audit row setLockedThrough itself writes', async () => {
    const user = await db().query.User.findFirst()
    await posting(organizationId, '2026-03-10', new Date(Date.now() - 60_000))
    await setLockedThrough(db(), {
      organizationId,
      periodKey: '2026-03',
      actorUserId: user!.id,
    })
    const late = await posting(organizationId, '2026-03-11', new Date(Date.now() + 60_000))

    const months = await read()
    expect(ids(months)).toEqual({ '2026-03': [late] })
    expect(months[0]!.reviewedAtApproximate).toBe(false)
  })
})
