// packages/lib/src/mail-filters/client.test.ts

import { describe, expect, it } from 'vitest'
import { getMailFilterFields, MAIL_FILTER_EXCLUDED_FIELD_IDS } from './client'

const idsOf = (...args: Parameters<typeof getMailFilterFields>) =>
  getMailFilterFields(...args).map((f) => f.id)

describe('getMailFilterFields — the unscoped catalog', () => {
  it('drops exactly the fields a filter must not offer', () => {
    for (const excluded of MAIL_FILTER_EXCLUDED_FIELD_IDS) {
      expect(idsOf()).not.toContain(excluded)
    }
    expect(idsOf()).toContain('from')
    expect(idsOf()).toContain('channelType')
  })

  it('is the fallback whenever the channel set is unknown — hiding nothing', () => {
    // Loading, or a caller without the capability to read channels. A hidden
    // field costs the author a condition they cannot re-add; a shown one that
    // can never match costs nothing.
    expect(idsOf(undefined)).toEqual(idsOf())
    expect(idsOf([])).toEqual(idsOf())
  })
})

describe('getMailFilterFields — soft scoping to an inbox', () => {
  it('hides the email-only fields on a phone-only inbox', () => {
    const ids = idsOf(['PHONE'])

    expect(ids).not.toContain('list')
    expect(ids).not.toContain('senderDomain')
    expect(ids).not.toContain('hasAttachments')
  })

  it('keeps `subject` there — empty is not the same as meaningless', () => {
    // SMS threads store `subject = ''`, and `subject is empty` is a legitimate
    // predicate over that.
    expect(idsOf(['PHONE'])).toContain('subject')
  })

  it('hides nothing on a MIXED inbox — an inbox is a union of channel types', () => {
    expect(idsOf(['PHONE', 'EMAIL'])).toEqual(idsOf())
  })

  it('keeps a hidden field that the filter being edited already uses', () => {
    // Otherwise opening an existing filter would silently drop conditions out
    // of the editor — and saving would then delete them.
    const ids = idsOf(['PHONE'], ['senderDomain'])

    expect(ids).toContain('senderDomain')
    expect(ids).not.toContain('list')
  })

  it('narrows the participant typeahead on the address fields', () => {
    const from = getMailFilterFields(['PHONE']).find((f) => f.id === 'from')

    expect(from?.options?.email?.identifierTypes).toEqual(['PHONE'])
    // The participant role is untouched by scoping.
    expect(from?.options?.email?.participantType).toBe('from')
  })

  it('never mutates the shared catalog', () => {
    getMailFilterFields(['PHONE'])
    expect(getMailFilterFields().find((f) => f.id === 'from')?.options?.email).toEqual({
      participantType: 'from',
    })
  })
})
