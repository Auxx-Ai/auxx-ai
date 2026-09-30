// packages/lib/src/accounting/documents/lines/__tests__/writes.int.test.ts
//
// The line writers against a real org: the field-value layer, the hook registry and the totals
// engine run for real, so a write that bypasses the hooks shows up as a stale header.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../../errors'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import { createLines, deleteLines, updateLine } from '../writes'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in line write tests')
  },
}))
vi.mock('../../../../events', () => ({ publisher: { publishLater: vi.fn(), publish: vi.fn() } }))
vi.mock('../../../../dedup/enqueue-scan', () => ({ enqueueDuplicateScan: async () => {} }))
vi.mock('../../../../realtime', async (original) => ({
  ...(await original<typeof import('../../../../realtime')>()),
  getRealtimeService: () => ({ publish: async () => true }),
}))
vi.mock('../realtime', () => ({ publishLinesUpdated: async () => {} }))

const db = () => getTestDb() as unknown as Database
let organizationId: string
let userId: string
let quoteId: string
let defIds: Map<string, string>
let fields: Map<string, typeof schema.CustomField.$inferSelect>

async function instance(entityType: string): Promise<string> {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: defIds.get(entityType)!,
      createdById: userId,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

async function value(
  entityId: string,
  attribute: string,
  data: Partial<typeof schema.FieldValue.$inferInsert>
): Promise<void> {
  const field = fields.get(attribute)!
  await db()
    .insert(schema.FieldValue)
    .values({
      organizationId,
      entityId,
      fieldId: field.id,
      entityDefinitionId: field.entityDefinitionId!,
      ...data,
    })
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  userId = (await createTestUser()).id
  await db()
    .update(schema.Organization)
    .set({ systemUserId: userId })
    .where(eq(schema.Organization.id, organizationId))
  const defs = await createEntityDefinitions(db(), organizationId)
  const made = await createAllFields(db(), organizationId, defs)
  await linkRelationships(db(), defs, made)
  defIds = new Map([...defs].map(([entityType, def]) => [entityType, def.id]))
  const rows = await db()
    .select()
    .from(schema.CustomField)
    .where(eq(schema.CustomField.organizationId, organizationId))
  fields = new Map(rows.map((field) => [field.systemAttribute!, field]))
  quoteId = await instance('quote')
})

async function numberOf(entityId: string, attribute: string): Promise<number | null> {
  const [row] = await db()
    .select({ value: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityId),
        eq(schema.FieldValue.fieldId, fields.get(attribute)!.id)
      )
    )
  return row?.value ?? null
}

describe('line writes run the field hooks', () => {
  const ref = () => ({ documentType: 'quote' as const, documentId: quoteId })

  it('recomputes the line total and the quote header on update, and after a delete', async () => {
    const [line] = (
      await createLines(db(), organizationId, userId, {
        ...ref(),
        lines: [{ name: 'Widget A', qty: 1 }],
      })
    )._unsafeUnwrap()

    const priced = await updateLine(db(), organizationId, userId, {
      ...ref(),
      lineId: line!.id,
      patch: { unitPrice: 1250 },
    })
    expect(priced.isOk()).toBe(true)
    const tripled = await updateLine(db(), organizationId, userId, {
      ...ref(),
      lineId: line!.id,
      patch: { qty: 3 },
    })
    expect(tripled._unsafeUnwrap().lineTotal).toBe(3750)
    expect(await numberOf(line!.id, 'line_item_line_total')).toBe(3750)
    expect(await numberOf(quoteId, 'quote_subtotal')).toBe(3750)
    expect(await numberOf(quoteId, 'quote_total')).toBe(3750)

    const [other] = (
      await createLines(db(), organizationId, userId, {
        ...ref(),
        lines: [{ name: 'Widget B', qty: 2, unitPrice: 500 }],
      })
    )._unsafeUnwrap()
    expect(await numberOf(quoteId, 'quote_total')).toBe(4750)

    const deleted = await deleteLines(db(), organizationId, userId, { ...ref(), ids: [other!.id] })
    expect(deleted._unsafeUnwrap()).toEqual([other!.id])
    expect(await numberOf(quoteId, 'quote_subtotal')).toBe(3750)
    expect(await numberOf(quoteId, 'quote_total')).toBe(3750)
  })

  it('refuses a qty edit on an issued invoice with the lock pre-hook error', async () => {
    const invoiceId = await instance('invoice')
    await value(invoiceId, 'invoice_status', { optionId: 'sent' })
    const lineId = await instance('line_item')
    await value(lineId, 'line_item_invoice', {
      relatedEntityId: invoiceId,
      relatedEntityDefinitionId: defIds.get('invoice')!,
    })
    await value(lineId, 'line_item_qty', { valueNumber: 1 })

    const result = await updateLine(db(), organizationId, userId, {
      documentType: 'invoice',
      documentId: invoiceId,
      lineId,
      patch: { qty: 3 },
    })
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toContain("cannot change a line's quantity")
    expect(await numberOf(lineId, 'line_item_qty')).toBe(1)
  })
})
