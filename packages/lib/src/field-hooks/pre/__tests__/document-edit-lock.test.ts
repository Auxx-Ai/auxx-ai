// packages/lib/src/field-hooks/pre/__tests__/document-edit-lock.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreCreateEvent, EntityPreDeleteEvent, FieldPreHookEvent } from '../../types'

const h = vi.hoisted(() => ({
  state: { status: 'sent', label: 'Q-0007' } as { status: string; label: string } | null,
  editStamp: null as { openedAt: string; byUserId: string } | null,
  origin: undefined as string | undefined,
  lineParentRows: [] as Array<{ fieldId: string; relatedEntityId: string | null }>,
  readDocumentLockState: vi.fn(),
}))

vi.mock('../../../accounting/documents/edit-in-place/lock-state', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../accounting/documents/edit-in-place/lock-state'
  )
  return { ...actual, readDocumentLockState: h.readDocumentLockState }
})
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({
        line_item_quote: { id: 'f_quote' },
        line_item_order: { id: 'f_order' },
        purchase_order_line_purchase_order: { id: 'f_po' },
      }),
    }),
  }),
}))
vi.mock('../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: async () => h.editStamp,
}))
vi.mock('../../../resources/crud/write-session-als', () => ({
  getAmbientWriteSession: () => (h.origin ? { origin: { kind: h.origin }, depth: 0 } : undefined),
}))
vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = () => ({ limit: async () => h.lineParentRows })
  return { ...actual, database: { select: () => chain } }
})

import { ConflictError } from '../../../errors'
import {
  guardDocumentFields,
  guardDocumentLineCreate,
  guardDocumentLineDelete,
  guardDocumentLineFields,
} from '../document-edit-lock'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const QUOTE_ID = 'qu0te000000000000000001'
const ORDER_ID = '0rder000000000000000001'
const LINE_ID = 'l1ne00000000000000000001'

function fieldEvent(
  recordId: string,
  systemAttribute: string,
  allValues: Map<string, unknown> = new Map()
): FieldPreHookEvent {
  return {
    recordId: recordId as FieldPreHookEvent['recordId'],
    entityDefinitionId: recordId.split(':')[0]!,
    entityType: null,
    entitySlug: 'quotes',
    fieldId: 'f_whatever',
    systemAttribute: systemAttribute as FieldPreHookEvent['systemAttribute'],
    field: {} as FieldPreHookEvent['field'],
    newValue: { type: 'number', value: 1 } as FieldPreHookEvent['newValue'],
    existingValue: undefined,
    allValues,
    organizationId: ORG,
    bypass: new Set(),
  }
}

function deleteEvent(values: Record<string, unknown>, cascaded = false): EntityPreDeleteEvent {
  return {
    recordId: `linedef:${LINE_ID}` as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: 'linedef',
    entityType: 'line_item',
    entitySlug: 'line-items',
    values,
    organizationId: ORG,
    userId: 'u1',
    bypass: new Set(),
    cascaded,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state = { status: 'sent', label: 'Q-0007' }
  h.editStamp = null
  h.origin = undefined
  h.lineParentRows = [{ fieldId: 'f_quote', relatedEntityId: QUOTE_ID }]
  h.readDocumentLockState.mockImplementation(async () => h.state)
})

describe('the header lock', () => {
  it('refuses a person writing a sent quote, and names the remedy', async () => {
    const guard = guardDocumentFields('quote')
    const error = await guard(fieldEvent(`q:${QUOTE_ID}`, 'quote_discount_value')).catch((e) => e)
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toBe(
      'Quote Q-0007 is sent, so you cannot change it. Press Edit to unlock it, then Save.'
    )
  })

  it('passes while an edit is open, and on a draft', async () => {
    const guard = guardDocumentFields('quote')
    h.editStamp = { openedAt: '2026-09-22T00:00:00Z', byUserId: 'u1' }
    await expect(guard(fieldEvent(`q:${QUOTE_ID}`, 'quote_tax_rate'))).resolves.toBeDefined()
    h.editStamp = null
    h.state = { status: 'draft', label: 'Q-0007' }
    await expect(guard(fieldEvent(`q:${QUOTE_ID}`, 'quote_tax_rate'))).resolves.toBeDefined()
  })

  it('refuses a synced order without offering Edit', async () => {
    h.state = { status: 'synced', label: '#1001' }
    const guard = guardDocumentFields('order')
    const error = await guard(fieldEvent(`o:${ORDER_ID}`, 'order_tax_rate')).catch((e) => e)
    expect(error.message).toContain('managed by its sales channel')
    expect(error.message).not.toContain('Press Edit')
  })

  it('lets a sync, an automation and a seed through without a query', async () => {
    h.state = { status: 'synced', label: '#1001' }
    const guard = guardDocumentFields('order')
    for (const origin of ['sync', 'automation', 'seed']) {
      h.origin = origin
      await expect(guard(fieldEvent(`o:${ORDER_ID}`, 'order_contact'))).resolves.toBeDefined()
    }
    expect(h.readDocumentLockState).not.toHaveBeenCalled()
  })

  it('decides once per write, however many guarded fields it carries', async () => {
    h.state = { status: 'draft', label: 'Q-0007' }
    const guard = guardDocumentFields('quote')
    const allValues = new Map<string, unknown>()
    await guard(fieldEvent(`q:${QUOTE_ID}`, 'quote_tax_rate', allValues))
    await guard(fieldEvent(`q:${QUOTE_ID}`, 'quote_discount_value', allValues))
    await guard(fieldEvent(`q:${QUOTE_ID}`, 'quote_contact', allValues))
    expect(h.readDocumentLockState).toHaveBeenCalledTimes(1)
  })
})

describe('the line lock', () => {
  it('refuses a line of a sent quote, through its parent', async () => {
    const guard = guardDocumentLineFields('line-items')
    const error = await guard(fieldEvent(`l:${LINE_ID}`, 'line_item_qty')).catch((e) => e)
    expect(error.message).toBe(
      'Quote Q-0007 is sent, so you cannot change a line. Press Edit to unlock it, then Save.'
    )
    expect(h.readDocumentLockState).toHaveBeenCalledWith(expect.anything(), ORG, 'quote', QUOTE_ID)
  })

  it("skips an attribute the parent family does not lock, and a line that is neither's", async () => {
    h.lineParentRows = [{ fieldId: 'f_order', relatedEntityId: ORDER_ID }]
    const guard = guardDocumentLineFields('line-items')
    await expect(guard(fieldEvent(`l:${LINE_ID}`, 'line_item_optional'))).resolves.toBeDefined()
    h.lineParentRows = []
    await expect(guard(fieldEvent(`l:${LINE_ID}`, 'line_item_qty'))).resolves.toBeDefined()
    expect(h.readDocumentLockState).not.toHaveBeenCalled()
  })

  it('reads the parent off the write itself on a create', async () => {
    h.lineParentRows = []
    const guard = guardDocumentLineFields('line-items')
    const allValues = new Map<string, unknown>([
      ['f_order', { type: 'relationship', recordId: `o:${ORDER_ID}` }],
    ])
    h.state = { status: 'shipped', label: '#1001' }
    const error = await guard(fieldEvent(`l:${LINE_ID}`, 'line_item_qty', allValues)).catch(
      (e) => e
    )
    expect(error.message).toContain('Order #1001 is shipped')
  })

  it('refuses a new line on a locked order', async () => {
    h.state = { status: 'shipped', label: '#1001' }
    const guard = guardDocumentLineCreate('line-items')
    const event: EntityPreCreateEvent = {
      entityDefinitionId: 'linedef',
      entityType: 'line_item',
      entitySlug: 'line-items',
      values: { line_item_order: `o:${ORDER_ID}` },
      organizationId: ORG,
      userId: 'u1',
    }
    await expect(guard(event)).rejects.toThrow('cannot add a line')
  })

  it('refuses removing a line, but not when the whole document is being deleted', async () => {
    const guard = guardDocumentLineDelete('line-items')
    await expect(guard(deleteEvent({ line_item_quote: QUOTE_ID }))).rejects.toThrow(
      'cannot remove a line'
    )
    await expect(guard(deleteEvent({ line_item_quote: QUOTE_ID }, true))).resolves.toBeUndefined()
  })
})
