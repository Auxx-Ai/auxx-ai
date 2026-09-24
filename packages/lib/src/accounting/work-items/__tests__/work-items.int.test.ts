// packages/lib/src/accounting/work-items/__tests__/work-items.int.test.ts
//
// `AccountingWorkItem` in real SQL (91 §4.6): one row per stuck thing, a repeat
// counts on, success deletes, a fix wakes exactly what it unblocks, and the
// Blocked tab groups by (reasonCode, role, railId, glAccountId), with a reason
// level above the per-`externalRef` groups (106 §6.1).

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { workItemSentence } from '../codes'
import {
  countWorkItemGroups,
  listParkedSourceIds,
  listWorkItemGroups,
  listWorkItemsInGroup,
} from '../reads'
import { listDueWorkItems } from '../sweep'
import {
  wakePeriodLocked,
  wakeReasonCode,
  wakeRoleUnmapped,
  wakeSources,
  wakeTotalsNotStamped,
  wakeWorkItemGroup,
} from '../wake'
import { deleteWorkItem, deleteWorkItemsForSources, upsertWorkItem } from '../write'

const db = () => getTestDb()
let organizationId: string
let ownerId: string

async function park(input: Parameters<typeof upsertWorkItem>[2]) {
  expect((await upsertWorkItem(db(), organizationId, input)).isOk()).toBe(true)
}

async function row(sourceId: string) {
  const [found] = await db()
    .select()
    .from(schema.AccountingWorkItem)
    .where(
      and(
        eq(schema.AccountingWorkItem.organizationId, organizationId),
        eq(schema.AccountingWorkItem.sourceId, sourceId)
      )
    )
  return found ?? null
}

const unmapped = (sourceId: string, railId: string | null = 'pg_1') =>
  park({
    sourceKind: 'money_transaction',
    sourceId,
    stage: 'post',
    reasonCode: 'ROLE_UNMAPPED',
    role: 'clearing',
    railId,
  })

beforeEach(async () => {
  const org = await createTestOrganization()
  organizationId = org.id
  ownerId = org.ownerId
})

describe('write', () => {
  it('counts a repeat of the same code on and starts over on a new one', async () => {
    await unmapped('mt_1')
    await unmapped('mt_1')
    expect(await row('mt_1')).toMatchObject({ reasonCode: 'ROLE_UNMAPPED', attempts: 2 })

    await park({
      sourceKind: 'money_transaction',
      sourceId: 'mt_1',
      stage: 'post',
      reasonCode: 'PERIOD_LOCKED',
      periodKey: '2026-09',
    })
    expect(await row('mt_1')).toMatchObject({
      reasonCode: 'PERIOD_LOCKED',
      role: null,
      periodKey: '2026-09',
      attempts: 1,
    })
  })

  it('schedules by severity: an error waits a day, a skip never comes back', async () => {
    await unmapped('mt_err')
    const error = await row('mt_err')
    expect(error!.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000)

    await park({
      sourceKind: 'fulfillment',
      sourceId: 'ful_skip',
      stage: 'post',
      reasonCode: 'NOTHING_TO_RECOGNISE',
    })
    expect((await row('ful_skip'))!.nextAttemptAt).toBeNull()
  })

  it('deletes on success, and a deleted record takes every stage with it', async () => {
    await unmapped('mt_1')
    await deleteWorkItem(db(), organizationId, {
      sourceKind: 'money_transaction',
      sourceId: 'mt_1',
      stage: 'post',
    })
    expect(await row('mt_1')).toBeNull()

    await park({
      sourceKind: 'credit_memo',
      sourceId: 'cm_1',
      stage: 'issue',
      reasonCode: 'REFUSED',
    })
    await park({
      sourceKind: 'credit_memo',
      sourceId: 'cm_1',
      stage: 'post',
      reasonCode: 'PERIOD_LOCKED',
    })
    const swept = await deleteWorkItemsForSources(db(), organizationId, {
      sourceKind: 'credit_memo',
      sourceIds: ['cm_1'],
    })
    expect(swept._unsafeUnwrap()).toBe(2)
  })
})

describe('wake', () => {
  it('a role mapped on one rail wakes that rail only; an org-wide mapping wakes all', async () => {
    await unmapped('mt_a', 'pg_1')
    await unmapped('mt_b', 'pg_2')

    expect(
      (
        await wakeRoleUnmapped(db(), organizationId, { role: 'clearing', railId: 'pg_1' })
      )._unsafeUnwrap()
    ).toBe(1)
    expect(
      await listDueWorkItems(db(), organizationId, {
        stage: 'post',
        sourceKind: 'money_transaction',
        limit: 10,
      })
    ).toEqual(['mt_a'])

    expect(
      (await wakeRoleUnmapped(db(), organizationId, { role: 'clearing' }))._unsafeUnwrap()
    ).toBe(2)
  })

  it('reopening a period wakes only the rows whose month is now open', async () => {
    for (const [id, periodKey] of [
      ['mt_aug', '2026-08'],
      ['mt_sep', '2026-09'],
    ] as const)
      await park({
        sourceKind: 'money_transaction',
        sourceId: id,
        stage: 'post',
        reasonCode: 'PERIOD_LOCKED',
        periodKey,
      })

    expect(
      (await wakePeriodLocked(db(), organizationId, { lockedThrough: '2026-08' }))._unsafeUnwrap()
    ).toBe(1)
    expect(
      await listDueWorkItems(db(), organizationId, {
        stage: 'post',
        sourceKind: 'money_transaction',
        limit: 10,
      })
    ).toEqual(['mt_sep'])
  })

  it('the totals stamp wakes its shipments, and a source wake names its rows', async () => {
    await park({
      sourceKind: 'fulfillment',
      sourceId: 'ful_1',
      stage: 'post',
      reasonCode: 'TOTALS_NOT_STAMPED',
    })
    await park({
      sourceKind: 'fulfillment',
      sourceId: 'ful_2',
      stage: 'post',
      reasonCode: 'TOTALS_NOT_STAMPED',
    })
    expect(
      (
        await wakeTotalsNotStamped(db(), organizationId, { fulfillmentIds: ['ful_2'] })
      )._unsafeUnwrap()
    ).toBe(1)
    expect(
      (
        await wakeSources(db(), organizationId, {
          sourceKind: 'fulfillment',
          sourceIds: ['ful_1'],
          stage: 'post',
        })
      )._unsafeUnwrap()
    ).toBe(1)
  })
})

describe('reads', () => {
  it('groups by code and wake keys, and Retry all wakes the group', async () => {
    await unmapped('mt_1')
    await unmapped('mt_2')
    await unmapped('mt_3', 'pg_2')
    await park({
      sourceKind: 'fulfillment',
      sourceId: 'ful_1',
      stage: 'post',
      reasonCode: 'NOTHING_TO_RECOGNISE',
    })

    const groups = (await listWorkItemGroups(db(), organizationId, { limit: 10 }))._unsafeUnwrap()
    const byRail = new Map(
      groups.items.map((group) => [`${group.reasonCode}:${group.railId}`, group])
    )
    expect(byRail.get('ROLE_UNMAPPED:pg_1')).toMatchObject({
      count: 2,
      sourceKinds: ['money_transaction'],
    })
    expect(byRail.get('ROLE_UNMAPPED:pg_2')?.count).toBe(1)
    // The skip is visible, but not something the badge asks a person to do.
    expect(byRail.get('NOTHING_TO_RECOGNISE:null')?.count).toBe(1)
    expect((await countWorkItemGroups(db(), organizationId))._unsafeUnwrap()).toBe(2)

    const group = {
      reasonCode: 'ROLE_UNMAPPED',
      role: 'clearing',
      railId: 'pg_1',
      glAccountId: null,
    }
    const items = (
      await listWorkItemsInGroup(db(), organizationId, group, { limit: 10 })
    )._unsafeUnwrap()
    expect(items.items.map((item) => item.sourceId).sort()).toEqual(['mt_1', 'mt_2'])

    expect((await wakeWorkItemGroup(db(), organizationId, group))._unsafeUnwrap()).toBe(2)
    expect(
      (
        await listDueWorkItems(db(), organizationId, {
          stage: 'post',
          sourceKind: 'money_transaction',
          limit: 10,
        })
      ).sort()
    ).toEqual(['mt_1', 'mt_2'])
  })

  it('folds a gateway reason into one row, split per handle under it; an order code never splits', async () => {
    const gateway = (sourceId: string, externalRef: string) =>
      park({
        sourceKind: 'money_transaction',
        sourceId,
        stage: 'post',
        reasonCode: 'GATEWAY_UNMAPPED',
        externalRef,
      })
    await gateway('mt_1', 'authorize.net')
    await gateway('mt_2', 'authorize.net')
    await gateway('mt_3', 'Affirm')
    for (const [sourceId, externalRef] of [
      ['acc_1', '7396358946992'],
      ['acc_2', '7505197826224'],
    ] as const)
      await park({
        sourceKind: 'financial_source_acceptance',
        sourceId,
        stage: 'evidence',
        reasonCode: 'ORDER_NOT_FOUND',
        externalRef,
      })

    const top = (await listWorkItemGroups(db(), organizationId, { limit: 10 }))._unsafeUnwrap()
    const reasons = top.items.filter((group) => group.reasonCode === 'GATEWAY_UNMAPPED')
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ count: 3, refCount: 2, externalRef: null, role: null })
    const orders = top.items.filter((group) => group.reasonCode === 'ORDER_NOT_FOUND')
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ count: 2, externalRef: null, refCount: null })
    expect((await countWorkItemGroups(db(), organizationId))._unsafeUnwrap()).toBe(3)

    const gateways = (
      await listWorkItemGroups(db(), organizationId, {
        limit: 10,
        reasonCode: 'GATEWAY_UNMAPPED',
      })
    )._unsafeUnwrap()
    // Largest first; the handle is its own label.
    expect(gateways.items.map((group) => [group.externalRef, group.count, group.refLabel])).toEqual(
      [
        ['authorize.net', 2, 'authorize.net'],
        ['Affirm', 1, 'Affirm'],
      ]
    )
    const authorize = gateways.items[0]!
    expect(workItemSentence(authorize.reasonCode, authorize)).toContain("'authorize.net'")

    const items = (
      await listWorkItemsInGroup(db(), organizationId, authorize, { limit: 10 })
    )._unsafeUnwrap()
    expect(items.items.map((item) => item.sourceId).sort()).toEqual(['mt_1', 'mt_2'])
    // Retry on one handle leaves the other handle's rows on their own schedule.
    expect((await wakeWorkItemGroup(db(), organizationId, authorize))._unsafeUnwrap()).toBe(2)
    expect((await wakeReasonCode(db(), organizationId, 'GATEWAY_UNMAPPED'))._unsafeUnwrap()).toBe(3)
  })

  it('names the part under a standard-cost reason, and pages the parts', async () => {
    const [def] = await db()
      .insert(schema.EntityDefinition)
      .values({
        organizationId,
        apiSlug: 'parts',
        entityType: 'part',
        singular: 'Part',
        plural: 'Parts',
        updatedAt: new Date(),
      })
      .returning({ id: schema.EntityDefinition.id })
    const part = async (displayName: string) => {
      const [row] = await db()
        .insert(schema.EntityInstance)
        .values({
          organizationId,
          entityDefinitionId: def!.id,
          displayName,
          createdById: ownerId,
          updatedAt: new Date(),
        })
        .returning({ id: schema.EntityInstance.id })
      return row!.id
    }
    const lift = await part('The Attic-Lift')
    const cable = await part('Cable Extension')
    const unpriced = (sourceId: string, partId: string) =>
      park({
        sourceKind: 'fulfillment',
        sourceId,
        stage: 'relieve',
        reasonCode: 'STANDARD_COST_MISSING',
        externalRef: partId,
      })
    await unpriced('ful_1', lift)
    await unpriced('ful_2', lift)
    await unpriced('ful_3', cable)

    const top = (await listWorkItemGroups(db(), organizationId, { limit: 10 }))._unsafeUnwrap()
    expect(top.items).toHaveLength(1)
    expect(top.items[0]).toMatchObject({
      reasonCode: 'STANDARD_COST_MISSING',
      count: 3,
      refCount: 2,
    })

    const first = (
      await listWorkItemGroups(db(), organizationId, {
        limit: 1,
        reasonCode: 'STANDARD_COST_MISSING',
      })
    )._unsafeUnwrap()
    expect(first.items.map((group) => [group.refLabel, group.count])).toEqual([
      ['The Attic-Lift', 2],
    ])
    expect(first.nextOffset).toBe(1)
    expect(workItemSentence('STANDARD_COST_MISSING', first.items[0])).toMatch(
      /^The Attic-Lift has no standard cost/
    )
    const second = (
      await listWorkItemGroups(db(), organizationId, {
        limit: 1,
        offset: 1,
        reasonCode: 'STANDARD_COST_MISSING',
      })
    )._unsafeUnwrap()
    expect(second.items.map((group) => group.refLabel)).toEqual(['Cable Extension'])
    expect(second.nextOffset).toBeUndefined()
  })

  it('counts the woken rows of a group as due', async () => {
    await unmapped('mt_1')
    await unmapped('mt_2')
    await unmapped('mt_3')
    await wakeSources(db(), organizationId, {
      sourceKind: 'money_transaction',
      sourceIds: ['mt_1', 'mt_2'],
    })

    const groups = (await listWorkItemGroups(db(), organizationId, { limit: 10 }))._unsafeUnwrap()
    expect(groups.items[0]).toMatchObject({ reasonCode: 'ROLE_UNMAPPED', count: 3, dueCount: 2 })
  })

  it('narrows to a category and pages by offset', async () => {
    await unmapped('mt_1')
    await park({
      sourceKind: 'fulfillment',
      sourceId: 'ful_1',
      stage: 'post',
      reasonCode: 'PERIOD_LOCKED',
    })

    const shipments = (
      await listWorkItemGroups(db(), organizationId, { limit: 10, categories: ['fulfillment'] })
    )._unsafeUnwrap()
    expect(shipments.items.map((group) => group.reasonCode)).toEqual(['PERIOD_LOCKED'])

    const first = (await listWorkItemGroups(db(), organizationId, { limit: 1 }))._unsafeUnwrap()
    expect(first.items).toHaveLength(1)
    expect(first.nextOffset).toBe(1)
  })

  it('names the sources whose row is not due, for a candidate list to subtract', async () => {
    await unmapped('mt_waiting')
    await unmapped('mt_due')
    await wakeSources(db(), organizationId, {
      sourceKind: 'money_transaction',
      sourceIds: ['mt_due'],
    })

    const parked = (
      await listParkedSourceIds(db(), organizationId, {
        sourceKind: 'money_transaction',
        stage: 'post',
        sourceIds: ['mt_waiting', 'mt_due', 'mt_never'],
      })
    )._unsafeUnwrap()
    expect([...parked]).toEqual(['mt_waiting'])
  })
})
