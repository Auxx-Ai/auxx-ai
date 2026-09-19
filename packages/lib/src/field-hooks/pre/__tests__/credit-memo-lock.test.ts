// packages/lib/src/field-hooks/pre/__tests__/credit-memo-lock.test.ts
//
// 74 §1.3's lock on an issued credit memo, the bill lock's twin: an issued memo
// with no edit-snapshot row refuses a header write, a line write, a line create
// and a line delete; the row lifts every one of them; a draft never fires; and
// `void` stays frozen whatever the row says.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreCreateEvent, EntityPreDeleteEvent, FieldPreHookEvent } from '../../types'

const h = vi.hoisted(() => ({
  fields: {} as Record<string, { id: string } | undefined>,
  memoRows: [] as Array<{ fieldId: string; optionId: string | null; valueText: string | null }>,
  lineParentRows: [] as Array<{ relatedEntityId: string | null }>,
  editStamp: null as { openedAt: string; byUserId: string } | null,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: async () => h.fields }),
  }),
}))
vi.mock('../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: async () => h.editStamp,
}))

vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = () =>
    Object.assign(Promise.resolve(h.memoRows), { limit: async () => h.lineParentRows })
  return { ...actual, database: { select: () => chain } }
})

import { ConflictError } from '../../../errors'
import {
  guardIssuedCreditMemoFields,
  guardIssuedCreditMemoLineCreate,
  guardIssuedCreditMemoLineDelete,
  guardIssuedCreditMemoLineFields,
} from '../credit-memo-lock'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const MEMO_DEF = 'memodef00000000000000001'
const MEMO_ID = 'memo00000000000000000001'
const LINE_DEF = 'cml1def00000000000000001'
const LINE_ID = 'cml100000000000000000001'

const STATUS_FIELD = 'f_status'
const NUMBER_FIELD = 'f_number'
const PARENT_FIELD = 'f_parent'

function fieldEvent(recordId: string, systemAttribute: string, value: unknown): FieldPreHookEvent {
  return {
    recordId: recordId as FieldPreHookEvent['recordId'],
    entityDefinitionId: recordId.split(':')[0]!,
    entityType: null,
    entitySlug: 'credit-memos',
    fieldId: 'f_whatever',
    systemAttribute: systemAttribute as FieldPreHookEvent['systemAttribute'],
    field: {} as FieldPreHookEvent['field'],
    newValue: value as FieldPreHookEvent['newValue'],
    existingValue: undefined,
    allValues: new Map(),
    organizationId: ORG,
    bypass: new Set(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fields = {
    credit_memo_status: { id: STATUS_FIELD },
    credit_memo_number: { id: NUMBER_FIELD },
    credit_memo_line_credit_memo: { id: PARENT_FIELD },
  }
  h.memoRows = [
    { fieldId: STATUS_FIELD, optionId: 'issued', valueText: null },
    { fieldId: NUMBER_FIELD, optionId: null, valueText: 'CM-0007' },
  ]
  h.lineParentRows = [{ relatedEntityId: MEMO_ID }]
  h.editStamp = null
})

describe('the header lock', () => {
  it('refuses a date write on an issued memo, naming it', async () => {
    await expect(
      guardIssuedCreditMemoFields(
        fieldEvent(`${MEMO_DEF}:${MEMO_ID}`, 'credit_memo_issued_at', '2026-10-01')
      )
    ).rejects.toThrow(ConflictError)
    await expect(
      guardIssuedCreditMemoFields(
        fieldEvent(`${MEMO_DEF}:${MEMO_ID}`, 'credit_memo_contact', 'ei_contact')
      )
    ).rejects.toThrow(/CM-0007/)
  })

  it('lets it through once an edit is open', async () => {
    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    const value = '2026-10-01'
    await expect(
      guardIssuedCreditMemoFields(
        fieldEvent(`${MEMO_DEF}:${MEMO_ID}`, 'credit_memo_issued_at', value)
      )
    ).resolves.toEqual(value)
  })

  it('never fires on a draft', async () => {
    h.memoRows = [{ fieldId: STATUS_FIELD, optionId: 'draft', valueText: null }]
    const value = 'ei_contact'
    await expect(
      guardIssuedCreditMemoFields(
        fieldEvent(`${MEMO_DEF}:${MEMO_ID}`, 'credit_memo_contact', value)
      )
    ).resolves.toEqual(value)
  })

  it('keeps a void memo frozen even with an edit row standing', async () => {
    h.memoRows = [{ fieldId: STATUS_FIELD, optionId: 'void', valueText: null }]
    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    await expect(
      guardIssuedCreditMemoFields(
        fieldEvent(`${MEMO_DEF}:${MEMO_ID}`, 'credit_memo_contact', 'ei_contact')
      )
    ).rejects.toThrow(/void/)
  })
})

describe('the line lock', () => {
  it('refuses a line amount write on an issued memo, and allows it once open', async () => {
    await expect(
      guardIssuedCreditMemoLineFields(
        fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'credit_memo_line_subtotal', 30_000)
      )
    ).rejects.toThrow(/line's amount/)

    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    await expect(
      guardIssuedCreditMemoLineFields(
        fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'credit_memo_line_subtotal', 30_000)
      )
    ).resolves.toEqual(30_000)
  })

  it('stands down for a line with no parent yet', async () => {
    h.lineParentRows = [{ relatedEntityId: null }]
    await expect(
      guardIssuedCreditMemoLineFields(
        fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'credit_memo_line_qty', 3)
      )
    ).resolves.toEqual(3)
  })

  it('refuses a new line on an issued memo', async () => {
    const event: EntityPreCreateEvent = {
      entityDefinitionId: LINE_DEF,
      entityType: 'credit_memo_line',
      entitySlug: 'credit-memo-lines',
      values: { credit_memo_line_credit_memo: `${MEMO_DEF}:${MEMO_ID}` },
      organizationId: ORG,
      userId: 'u1',
    }
    await expect(guardIssuedCreditMemoLineCreate(event)).rejects.toThrow(/add a line/)
  })

  it('refuses a line delete on an issued memo, and allows it once open', async () => {
    const event: EntityPreDeleteEvent = {
      recordId: `${LINE_DEF}:${LINE_ID}` as EntityPreDeleteEvent['recordId'],
      entityDefinitionId: LINE_DEF,
      entityType: 'credit_memo_line',
      entitySlug: 'credit-memo-lines',
      // The capture chain arrays every relationship, even a to-one.
      values: { credit_memo_line_credit_memo: [`${MEMO_DEF}:${MEMO_ID}`] },
      organizationId: ORG,
      userId: 'u1',
      bypass: new Set(),
    }
    await expect(guardIssuedCreditMemoLineDelete(event)).rejects.toThrow(/remove a line/)

    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    await expect(guardIssuedCreditMemoLineDelete(event)).resolves.toBeUndefined()
  })
})
