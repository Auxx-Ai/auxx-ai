// packages/lib/src/field-hooks/__tests__/guest-order-contact.test.ts
//
// Task 79 §5. "Every order has a customer" is what removes the guest case from
// the ingest, the poster and aging, so the two halves pinned here are: a
// customerless order gets the guest, and an order that names either party keeps
// what it was given.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getOrganizationSetting: vi.fn(),
  related: vi.fn(),
}))

// The memo hook reads the order's contact straight off `FieldValue`. Only
// `database` is overridden — `schema` and the rest stay real for every other
// importer the graph pulls in.
vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  database: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const related = await h.related()
            return related ? [{ related }] : []
          },
        }),
      }),
    }),
  },
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../settings', () => ({ getOrganizationSetting: h.getOrganizationSetting }))

import {
  fillGuestCreditMemoContact,
  fillGuestOrderContact,
  guardGuestContactDelete,
} from '../pre/guest-order-contact'
import type { EntityPreCreateEvent, EntityPreDeleteEvent } from '../types'

const ORG = 'org1'
const GUEST = 'contact-guest'
const GUEST_RECORD = `contact:${GUEST}`

function createEvent(values: Record<string, unknown>): EntityPreCreateEvent {
  return {
    entityDefinitionId: 'def-order',
    entityType: 'order',
    entitySlug: 'orders',
    values,
    organizationId: ORG,
    userId: 'user1',
  }
}

function deleteEvent(instanceId: string): EntityPreDeleteEvent {
  return {
    recordId: `contact:${instanceId}` as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: 'def-contact',
    entityType: 'contact',
    entitySlug: 'contacts',
    values: {},
    organizationId: ORG,
    userId: 'user1',
    bypass: new Set(),
  }
}

beforeEach(() => {
  h.bySystemAttributes
    .mockReset()
    .mockResolvedValue({ order_contact: { id: 'f-contact' }, order_company: { id: 'f-company' } })
  h.getOrganizationSetting.mockReset().mockResolvedValue(GUEST)
})

describe('fillGuestOrderContact', () => {
  it('names the guest on an order with no contact and no company', async () => {
    const event = createEvent({ order_total: 30 })

    await fillGuestOrderContact(event)

    expect(event.values.order_contact).toBe(GUEST_RECORD)
  })

  it('leaves an order that already names a contact untouched', async () => {
    const event = createEvent({ order_contact: 'contact:real' })

    await fillGuestOrderContact(event)

    expect(event.values.order_contact).toBe('contact:real')
  })

  it('leaves an order that names a company untouched', async () => {
    const event = createEvent({ order_company: 'company:acme' })

    await fillGuestOrderContact(event)

    expect(event.values.order_contact).toBeUndefined()
  })

  it('reads the party legs by field id too, the way the connector sink writes them', async () => {
    const event = createEvent({ 'f-contact': 'contact:real' })

    await fillGuestOrderContact(event)

    expect(event.values.order_contact).toBeUndefined()
  })

  it('treats an empty string or an empty array as no party', async () => {
    const event = createEvent({ order_contact: '', order_company: [] })

    await fillGuestOrderContact(event)

    expect(event.values.order_contact).toBe(GUEST_RECORD)
  })

  it('leaves the field empty for an org that never provisioned accounting', async () => {
    h.getOrganizationSetting.mockResolvedValue(null)
    const event = createEvent({ order_total: 30 })

    await fillGuestOrderContact(event)

    expect(event.values.order_contact).toBeUndefined()
  })

  // A sync that later attaches a real customer overwrites the guest by writing
  // `order_contact` through the update door, which runs no pre-create hook —
  // there is no update twin to register (see the file header).

  it('reads the guest id through the cache, with no db', async () => {
    await fillGuestOrderContact(createEvent({}))

    expect(h.getOrganizationSetting).toHaveBeenCalledWith({
      organizationId: ORG,
      key: 'accounting.guestContactId',
    })
  })
})

describe('guardGuestContactDelete', () => {
  it('refuses deleting the guest', async () => {
    await expect(guardGuestContactDelete(deleteEvent(GUEST))).rejects.toThrow(
      /guest customer is a system record/
    )
  })

  it('refuses a bulk delete that contains the guest, and allows one that does not', async () => {
    // `deleteEntity` and `bulkDeleteEntities` share `deleteRecords`, which runs
    // this hook once per record — so a bulk delete is this loop.
    const bulk = ['contact-a', GUEST, 'contact-b']
    const outcomes = await Promise.allSettled(
      bulk.map((id) => guardGuestContactDelete(deleteEvent(id)))
    )

    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })

  it('allows every delete in an org with no guest', async () => {
    h.getOrganizationSetting.mockResolvedValue(null)

    await expect(guardGuestContactDelete(deleteEvent(GUEST))).resolves.toBeUndefined()
  })
})

describe('fillGuestCreditMemoContact', () => {
  function memoEvent(values: Record<string, unknown>): EntityPreCreateEvent {
    return {
      entityDefinitionId: 'def-credit-memo',
      entityType: 'credit_memo',
      entitySlug: 'credit-memos',
      values,
      organizationId: ORG,
      userId: 'user1',
    }
  }

  beforeEach(() => {
    h.bySystemAttributes.mockResolvedValue({
      credit_memo_contact: { id: 'f-memo-contact' },
      credit_memo_order: { id: 'f-memo-order' },
      order_contact: { id: 'f-contact' },
    })
    h.related.mockReset().mockResolvedValue(null)
  })

  it('names the guest on a memo with no contact and no resolvable order', async () => {
    const event = memoEvent({ credit_memo_total: 30 })
    await fillGuestCreditMemoContact(event)
    expect(event.values.credit_memo_contact).toBe(GUEST_RECORD)
  })

  it('inherits the order contact over the guest when the order names one', async () => {
    h.related.mockResolvedValue('contact-real')
    const event = memoEvent({ credit_memo_order: 'order:order-1' })
    await fillGuestCreditMemoContact(event)
    expect(event.values.credit_memo_contact).toBe('contact:contact-real')
  })

  it('falls back to the guest when the order itself has no contact', async () => {
    const event = memoEvent({ credit_memo_order: 'order:order-1' })
    await fillGuestCreditMemoContact(event)
    expect(event.values.credit_memo_contact).toBe(GUEST_RECORD)
  })

  it('leaves a memo that already names a contact alone', async () => {
    const event = memoEvent({ credit_memo_contact: 'contact:someone' })
    await fillGuestCreditMemoContact(event)
    expect(event.values.credit_memo_contact).toBe('contact:someone')
  })

  it('does nothing when the org has no guest', async () => {
    h.getOrganizationSetting.mockResolvedValue(null)
    const event = memoEvent({ credit_memo_total: 30 })
    await fillGuestCreditMemoContact(event)
    expect(event.values.credit_memo_contact).toBeUndefined()
  })
})
