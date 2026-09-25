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
      reasonCode: 'UNBALANCED',
    })
    expect(await row('mt_1')).toMatchObject({
      reasonCode: 'UNBALANCED',
      role: null,
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
      reasonCode: 'UNBALANCED',
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
      sourceKindCounts: { money_transaction: 2 },
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
    // The badge counts the top level: one gateway reason row, one order group.
    expect((await countWorkItemGroups(db(), organizationId))._unsafeUnwrap()).toBe(2)
    expect(top.items).toHaveLength(2)

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

  it('counts each kind under a part, at the reason and at the part', async () => {
    const unpriced = (sourceKind: string, sourceId: string, partId: string) =>
      park({
        sourceKind,
        sourceId,
        stage: 'price',
        reasonCode: 'STANDARD_COST_MISSING',
        externalRef: partId,
      })
    await unpriced('fulfillment', 'ful_1', 'part_lift')
    await unpriced('fulfillment', 'ful_2', 'part_lift')
    await unpriced('build', 'bld_1', 'part_lift')
    await unpriced('stock_movement', 'mov_1', 'part_cable')

    const top = (await listWorkItemGroups(db(), organizationId, { limit: 10 }))._unsafeUnwrap()
    expect(top.items[0]).toMatchObject({
      count: 4,
      refCount: 2,
      sourceKindCounts: { fulfillment: 2, build: 1, stock_movement: 1 },
    })
    expect(top.items[0]!.sourceKinds.sort()).toEqual(['build', 'fulfillment', 'stock_movement'])

    const parts = (
      await listWorkItemGroups(db(), organizationId, {
        limit: 10,
        reasonCode: 'STANDARD_COST_MISSING',
      })
    )._unsafeUnwrap()
    expect(parts.items.map((group) => [group.externalRef, group.sourceKindCounts])).toEqual([
      ['part_lift', { fulfillment: 2, build: 1 }],
      ['part_cable', { stock_movement: 1 }],
    ])
  })

  it('names a build and a count on the item read, dated by their own fields', async () => {
    const def = async (entityType: string) => {
      const [row] = await db()
        .insert(schema.EntityDefinition)
        .values({
          organizationId,
          apiSlug: `${entityType}s`,
          entityType,
          singular: entityType,
          plural: `${entityType}s`,
          updatedAt: new Date(),
        })
        .returning({ id: schema.EntityDefinition.id })
      return row!.id
    }
    const buildDef = await def('build')
    const movementDef = await def('stock_movement')
    const field = async (
      entityDefinitionId: string,
      systemAttribute: string,
      type: 'SINGLE_SELECT' | 'NUMBER' | 'DATETIME'
    ) => {
      const [row] = await db()
        .insert(schema.CustomField)
        .values({
          organizationId,
          entityDefinitionId,
          systemAttribute,
          name: systemAttribute,
          type,
          isCustom: false,
          updatedAt: new Date(),
        })
        .returning({ id: schema.CustomField.id })
      return row!.id
    }
    const fields = {
      type: await field(movementDef, 'stock_movement_type', 'SINGLE_SELECT'),
      quantity: await field(movementDef, 'stock_movement_quantity', 'NUMBER'),
      occurredAt: await field(movementDef, 'stock_movement_occurred_at', 'DATETIME'),
      completedAt: await field(buildDef, 'build_completed_at', 'DATETIME'),
    }
    const record = async (entityDefinitionId: string, displayName: string | null) => {
      const [row] = await db()
        .insert(schema.EntityInstance)
        .values({
          organizationId,
          entityDefinitionId,
          displayName,
          createdById: ownerId,
          updatedAt: new Date(),
        })
        .returning({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
      return row!
    }
    const value = (
      entityDefinitionId: string,
      entityId: string,
      fieldId: string,
      data: Partial<typeof schema.FieldValue.$inferInsert>
    ) =>
      db()
        .insert(schema.FieldValue)
        .values({ organizationId, entityDefinitionId, entityId, fieldId, ...data })

    const build = await record(buildDef, 'B-0007')
    await value(buildDef, build.id, fields.completedAt, { valueDate: '2026-03-20T09:00:00.000Z' })
    const nameless = await record(movementDef, null)
    await value(movementDef, nameless.id, fields.type, { optionId: 'adjust' })
    await value(movementDef, nameless.id, fields.quantity, { valueNumber: -3 })
    await value(movementDef, nameless.id, fields.occurredAt, {
      valueDate: '2026-03-15T12:00:00.000Z',
    })
    const named = await record(movementDef, 'Receive · 5')

    const refused = (sourceKind: string, sourceId: string) =>
      park({ sourceKind, sourceId, stage: 'price', reasonCode: 'REFUSED' })
    await refused('build', build.id)
    await refused('stock_movement', nameless.id)
    await refused('stock_movement', named.id)
    await refused('fulfillment', 'ful_1')

    const group = { reasonCode: 'REFUSED', role: null, railId: null, glAccountId: null }
    const items = (
      await listWorkItemsInGroup(db(), organizationId, group, { limit: 10 })
    )._unsafeUnwrap()
    const byId = new Map(items.items.map((item) => [item.sourceId, item]))
    expect(byId.get(build.id)).toMatchObject({
      label: 'B-0007',
      recordDefinitionId: buildDef,
      documentDate: new Date('2026-03-20T09:00:00.000Z'),
    })
    expect(byId.get(nameless.id)).toMatchObject({
      label: 'Adjustment · -3',
      recordDefinitionId: movementDef,
      documentDate: new Date('2026-03-15T12:00:00.000Z'),
    })
    // A named count keeps its display name and, with no occurred-at, falls back to its creation.
    expect(byId.get(named.id)).toMatchObject({
      label: 'Receive · 5',
      documentDate: named.createdAt,
    })
    expect(byId.get('ful_1')).toMatchObject({ label: null, documentDate: null })
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
      reasonCode: 'UNBALANCED',
    })

    const shipments = (
      await listWorkItemGroups(db(), organizationId, { limit: 10, categories: ['fulfillment'] })
    )._unsafeUnwrap()
    expect(shipments.items.map((group) => group.reasonCode)).toEqual(['UNBALANCED'])

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
