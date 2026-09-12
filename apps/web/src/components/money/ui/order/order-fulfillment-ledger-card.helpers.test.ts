// apps/web/src/components/money/ui/order/order-fulfillment-ledger-card.helpers.test.ts
//
// plans/money/tasks/55-shipment-lines.md §6: a cancelled fulfillment is now a
// real record rather than an absence, and `fulfillmentBadge` is what decides
// how the ledger card tells it apart from a live shipment.

import { describe, expect, it } from 'vitest'
import {
  formatShippedAt,
  fulfillmentBadge,
  trackingLabel,
} from './order-fulfillment-ledger-card.helpers'

describe('formatShippedAt', () => {
  it('formats a valid ISO instant', () => {
    expect(formatShippedAt('2026-09-11T14:32:00.000Z')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
        new Date('2026-09-11T14:32:00.000Z')
      )
    )
  })

  it('falls back for an empty string', () => {
    expect(formatShippedAt('')).toBe('Unknown date')
  })

  it('returns the raw string for an unparseable value', () => {
    expect(formatShippedAt('not-a-date')).toBe('not-a-date')
  })
})

describe('fulfillmentBadge', () => {
  it('shows Cancelled for a cancelled fulfillment, even one that was posted', () => {
    expect(fulfillmentBadge({ status: 'cancelled', glPosting: 'gl_1' }, 'posted')).toEqual({
      label: 'Cancelled',
      variant: 'red',
    })
  })

  it('shows Cancelled over Reversed when both apply', () => {
    expect(fulfillmentBadge({ status: 'cancelled', glPosting: 'gl_1' }, 'reversed')).toEqual({
      label: 'Cancelled',
      variant: 'red',
    })
  })

  it('shows Reversed for a live fulfillment whose posting was reversed', () => {
    expect(fulfillmentBadge({ status: 'success', glPosting: 'gl_1' }, 'reversed')).toEqual({
      label: 'Reversed',
      variant: 'amber',
    })
  })

  it('shows the channel status when a live fulfillment has not posted yet', () => {
    expect(fulfillmentBadge({ status: 'open', glPosting: null }, undefined)).toEqual({
      label: 'In transit',
      variant: 'blue',
    })
  })

  it('shows no badge for a posted, non-reversed, non-cancelled fulfillment', () => {
    expect(fulfillmentBadge({ status: 'success', glPosting: 'gl_1' }, 'posted')).toBeNull()
  })
})

describe('trackingLabel', () => {
  it('combines carrier and tracking number', () => {
    expect(trackingLabel({ trackingCompany: 'UPS', trackingNumber: '1Z999' })).toBe('UPS · 1Z999')
  })

  it('falls back to just the number when there is no carrier', () => {
    expect(trackingLabel({ trackingCompany: null, trackingNumber: '1Z999' })).toBe('1Z999')
  })

  it('is undefined when there is no tracking number at all', () => {
    expect(trackingLabel({ trackingCompany: null, trackingNumber: null })).toBeUndefined()
  })
})
