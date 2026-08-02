// packages/lib/src/ingest/filtering/__tests__/bulk-mail.test.ts

import { describe, expect, it } from 'vitest'
import { BULK_MAIL_HEADER_ALLOWLIST, deriveBulkMailFields, pickBulkMailHeaders } from '../bulk-mail'
import { MACHINE_MAIL_HEADER_ALLOWLIST } from '../machine-mail'
import { pickPersistedHeaders } from '../persisted-headers'

/** Real `Authentication-Results` values, trimmed to what the parser reads. */
const GMAIL_PASS =
  'mx.google.com; dkim=pass header.i=@stripe.com header.s=cordial header.b=abc123; ' +
  'spf=pass (google.com: domain of bounce@stripe.com designates 1.2.3.4 as permitted sender) ' +
  'smtp.mailfrom=bounce@stripe.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=stripe.com'

describe('pickBulkMailHeaders', () => {
  it('picks only the allowlisted headers, lowercasing the names', () => {
    const picked = pickBulkMailHeaders([
      { name: 'List-Id', value: 'Acme News <news.acme.com>' },
      { name: 'List-Unsubscribe', value: '<https://acme.com/u/1>' },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
      { name: 'Authentication-Results', value: GMAIL_PASS },
      { name: 'Subject', value: 'Weekly digest' },
      { name: 'X-Mailer', value: 'Mailchimp' },
    ])

    expect(Object.keys(picked ?? {}).sort()).toEqual([
      'authentication-results',
      'list-id',
      'list-unsubscribe',
      'list-unsubscribe-post',
    ])
    expect(picked?.['list-id']).toBe('Acme News <news.acme.com>')
  })

  it('reads postal-mime `key` entries as well as Graph `name` entries', () => {
    expect(pickBulkMailHeaders([{ key: 'list-id', value: '<a.b.com>' }])).toEqual({
      'list-id': '<a.b.com>',
    })
  })

  // The topmost `Authentication-Results` is the one the receiving MTA stamped —
  // the only hop we have any reason to trust.
  it('keeps the first occurrence of a repeated header', () => {
    const picked = pickBulkMailHeaders([
      { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass' },
      { name: 'Authentication-Results', value: 'relay.evil.example; dmarc=pass' },
    ])
    expect(picked?.['authentication-results']).toBe('mx.google.com; dmarc=pass')
  })

  it('returns undefined when nothing matched', () => {
    expect(pickBulkMailHeaders([{ name: 'Subject', value: 'hi' }])).toBeUndefined()
    expect(pickBulkMailHeaders([])).toBeUndefined()
    expect(pickBulkMailHeaders(undefined)).toBeUndefined()
  })

  it('keeps a present-but-empty header as an empty string', () => {
    expect(pickBulkMailHeaders([{ name: 'List-Id', value: null }])).toEqual({ 'list-id': '' })
  })

  // The whole point of a fourth picker: the machine-mail allowlist is the input
  // contract of `detectMachineMail` and must not grow headers it does not read.
  it('does not push its new headers into the machine-mail allowlist', () => {
    expect(MACHINE_MAIL_HEADER_ALLOWLIST).not.toContain('list-unsubscribe-post')
    expect(MACHINE_MAIL_HEADER_ALLOWLIST).not.toContain('authentication-results')
    expect(BULK_MAIL_HEADER_ALLOWLIST).toEqual([
      'list-unsubscribe',
      'list-unsubscribe-post',
      'list-id',
      'authentication-results',
    ])
  })
})

describe('pickPersistedHeaders (the Outlook/IMAP merge)', () => {
  it('merges both allowlists into one map', () => {
    const merged = pickPersistedHeaders([
      { name: 'Auto-Submitted', value: 'auto-generated' },
      { name: 'Precedence', value: 'bulk' },
      { name: 'List-Id', value: '<news.acme.com>' },
      { name: 'List-Unsubscribe', value: '<https://acme.com/u/1>' },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
      { name: 'Authentication-Results', value: GMAIL_PASS },
    ])

    expect(Object.keys(merged ?? {}).sort()).toEqual([
      'authentication-results',
      'auto-submitted',
      'list-id',
      'list-unsubscribe',
      'list-unsubscribe-post',
      'precedence',
    ])
  })

  it('keeps machine-mail-only headers when there is no bulk header', () => {
    expect(pickPersistedHeaders([{ name: 'Return-Path', value: '<>' }])).toEqual({
      'return-path': '<>',
    })
  })

  it('keeps bulk-only headers when there is no machine-mail header', () => {
    expect(
      pickPersistedHeaders([{ name: 'Authentication-Results', value: 'x; dmarc=pass' }])
    ).toEqual({ 'authentication-results': 'x; dmarc=pass' })
  })

  it('agrees with both pickers on the headers they share', () => {
    const entries = [{ name: 'List-Id', value: 'Acme <news.acme.com>' }]
    const merged = pickPersistedHeaders(entries)
    expect(merged?.['list-id']).toBe('Acme <news.acme.com>')
  })

  // Stays undefined so a header-less message does not start persisting `headers: {}`.
  it('returns undefined when neither picker matched', () => {
    expect(pickPersistedHeaders([{ name: 'Subject', value: 'hi' }])).toBeUndefined()
    expect(pickPersistedHeaders([])).toBeUndefined()
    expect(pickPersistedHeaders(undefined)).toBeUndefined()
  })
})

describe('deriveBulkMailFields — listId', () => {
  it('strips angle brackets', () => {
    expect(deriveBulkMailFields({ headers: { 'list-id': '<news.acme.com>' } }).listId).toBe(
      'news.acme.com'
    )
  })

  it('strips the human description in front of the brackets', () => {
    expect(
      deriveBulkMailFields({ headers: { 'list-id': 'ACME News <news.acme.com>' } }).listId
    ).toBe('news.acme.com')
  })

  it('lowercases and trims', () => {
    expect(
      deriveBulkMailFields({ headers: { 'list-id': '  "Acme" <NEWS.Acme.COM>  ' } }).listId
    ).toBe('news.acme.com')
  })

  it('takes a bracket-less value whole', () => {
    expect(deriveBulkMailFields({ headers: { 'list-id': 'news.acme.com' } }).listId).toBe(
      'news.acme.com'
    )
  })

  it('is null when the header is absent, empty, or empty-bracketed', () => {
    expect(deriveBulkMailFields({}).listId).toBeNull()
    expect(deriveBulkMailFields({ headers: { 'list-id': '' } }).listId).toBeNull()
    expect(deriveBulkMailFields({ headers: { 'list-id': '<>' } }).listId).toBeNull()
    expect(deriveBulkMailFields({ headers: { 'list-id': '   ' } }).listId).toBeNull()
  })

  it('reads the first value of an array-valued header', () => {
    expect(
      deriveBulkMailFields({ headers: { 'list-id': ['<first.acme.com>', '<second.acme.com>'] } })
        .listId
    ).toBe('first.acme.com')
  })
})

describe('deriveBulkMailFields — senderDomain', () => {
  it('reduces a subdomain to the registrable domain', () => {
    expect(deriveBulkMailFields({ fromEmail: 'news@mail.sales.acme.co.uk' }).senderDomain).toBe(
      'acme.co.uk'
    )
  })

  // The reason listId exists: VERP fragments any grouping keyed on the address,
  // but the registrable domain survives it.
  it('survives a VERP from-address', () => {
    const verp = 'bounce+abc123.def456-customer=example.com@mailer.mailchimpapp.com'
    expect(deriveBulkMailFields({ fromEmail: verp }).senderDomain).toBe('mailchimpapp.com')
  })

  it('lowercases', () => {
    expect(deriveBulkMailFields({ fromEmail: 'Hi@Notifications.GitHub.com' }).senderDomain).toBe(
      'github.com'
    )
  })

  it('tolerates an address that still carries its angle brackets', () => {
    expect(deriveBulkMailFields({ fromEmail: '<receipts@stripe.com>' }).senderDomain).toBe(
      'stripe.com'
    )
  })

  it('is null when there is no parseable domain', () => {
    expect(deriveBulkMailFields({}).senderDomain).toBeNull()
    expect(deriveBulkMailFields({ fromEmail: null }).senderDomain).toBeNull()
    expect(deriveBulkMailFields({ fromEmail: 'not-an-address' }).senderDomain).toBeNull()
    expect(deriveBulkMailFields({ fromEmail: 'user@' }).senderDomain).toBeNull()
    expect(deriveBulkMailFields({ fromEmail: 'user@localhost' }).senderDomain).toBeNull()
  })
})

describe('deriveBulkMailFields — unsubscribeMeta', () => {
  it('parses both URI forms in either order', () => {
    const both = '<https://list.acme.com/u/9>, <mailto:unsub@acme.com?subject=unsub>'
    expect(deriveBulkMailFields({ headers: { 'list-unsubscribe': both } }).unsubscribeMeta).toEqual(
      {
        httpUrl: 'https://list.acme.com/u/9',
        mailto: 'mailto:unsub@acme.com?subject=unsub',
        oneClick: false,
      }
    )

    const reversed = '<mailto:unsub@acme.com>, <https://list.acme.com/u/9>'
    expect(
      deriveBulkMailFields({ headers: { 'list-unsubscribe': reversed } }).unsubscribeMeta
    ).toEqual({
      httpUrl: 'https://list.acme.com/u/9',
      mailto: 'mailto:unsub@acme.com',
      oneClick: false,
    })
  })

  it('parses an http-only header', () => {
    expect(
      deriveBulkMailFields({ headers: { 'list-unsubscribe': '<http://acme.com/u>' } })
        .unsubscribeMeta
    ).toEqual({ httpUrl: 'http://acme.com/u', oneClick: false })
  })

  it('parses a mailto-only header', () => {
    expect(
      deriveBulkMailFields({ headers: { 'list-unsubscribe': '<mailto:u@acme.com>' } })
        .unsubscribeMeta
    ).toEqual({ mailto: 'mailto:u@acme.com', oneClick: false })
  })

  it('falls back to a comma split for a bracket-less sender', () => {
    expect(
      deriveBulkMailFields({
        headers: { 'list-unsubscribe': 'https://acme.com/u, mailto:u@acme.com' },
      }).unsubscribeMeta
    ).toEqual({ httpUrl: 'https://acme.com/u', mailto: 'mailto:u@acme.com', oneClick: false })
  })

  it('sets oneClick when List-Unsubscribe-Post says so and an http url is present', () => {
    expect(
      deriveBulkMailFields({
        headers: {
          'list-unsubscribe': '<https://acme.com/u>',
          'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
        },
      }).unsubscribeMeta
    ).toEqual({ httpUrl: 'https://acme.com/u', oneClick: true })
  })

  it('matches List-Unsubscribe-Post case-insensitively and around whitespace', () => {
    expect(
      deriveBulkMailFields({
        headers: {
          'list-unsubscribe': '<https://acme.com/u>',
          'list-unsubscribe-post': 'list-unsubscribe = ONE-CLICK',
        },
      }).unsubscribeMeta?.oneClick
    ).toBe(true)
  })

  // RFC 8058: one-click is a property of the HTTP endpoint. Reporting it without
  // one would license a POST with nothing to POST to.
  it('never reports oneClick without an http url', () => {
    expect(
      deriveBulkMailFields({
        headers: {
          'list-unsubscribe': '<mailto:u@acme.com>',
          'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
        },
      }).unsubscribeMeta
    ).toEqual({ mailto: 'mailto:u@acme.com', oneClick: false })
  })

  it('is null when there is no usable URI', () => {
    expect(deriveBulkMailFields({}).unsubscribeMeta).toBeNull()
    expect(deriveBulkMailFields({ headers: { 'list-unsubscribe': '' } }).unsubscribeMeta).toBeNull()
    expect(
      deriveBulkMailFields({ headers: { 'list-unsubscribe': '<ftp://acme.com/u>' } })
        .unsubscribeMeta
    ).toBeNull()
    expect(
      deriveBulkMailFields({ headers: { 'list-unsubscribe-post': 'List-Unsubscribe=One-Click' } })
        .unsubscribeMeta
    ).toBeNull()
  })

  it('keeps the first url of each form', () => {
    expect(
      deriveBulkMailFields({
        headers: { 'list-unsubscribe': '<https://a.com/1>, <https://b.com/2>' },
      }).unsubscribeMeta
    ).toEqual({ httpUrl: 'https://a.com/1', oneClick: false })
  })
})

describe('deriveBulkMailFields — senderAuthenticated', () => {
  it('is true on dmarc=pass', () => {
    expect(
      deriveBulkMailFields({ headers: { 'authentication-results': GMAIL_PASS } })
        .senderAuthenticated
    ).toBe(true)
  })

  it('is true on dkim=pass + spf=pass without a dmarc verdict', () => {
    expect(
      deriveBulkMailFields({
        headers: {
          'authentication-results':
            'mx.example.com; dkim=pass header.d=sendgrid.net; spf=pass smtp.mailfrom=sendgrid.net',
        },
      }).senderAuthenticated
    ).toBe(true)
  })

  // Forwarded mail routinely breaks SPF while staying DKIM-aligned; DMARC is the
  // verdict that matters, so a pass there wins over the SPF failure.
  it('is true on dmarc=pass even when spf fails', () => {
    expect(
      deriveBulkMailFields({
        headers: {
          'authentication-results':
            'mx.google.com; dkim=pass header.i=@github.com; spf=fail smtp.mailfrom=bounce@fwd.example; dmarc=pass header.from=github.com',
        },
      }).senderAuthenticated
    ).toBe(true)
  })

  it('is false on an explicit fail', () => {
    expect(
      deriveBulkMailFields({
        headers: { 'authentication-results': 'mx.google.com; dmarc=fail header.from=evil.example' },
      }).senderAuthenticated
    ).toBe(false)
    expect(
      deriveBulkMailFields({
        headers: { 'authentication-results': 'mx.example.com; spf=softfail; dkim=none' },
      }).senderAuthenticated
    ).toBe(false)
  })

  // Invariant 3. Null is unknown; every read must treat it as not authenticated.
  it('is NULL — never false, never true — when the header is absent', () => {
    expect(deriveBulkMailFields({}).senderAuthenticated).toBeNull()
    expect(deriveBulkMailFields({ headers: {} }).senderAuthenticated).toBeNull()
    expect(
      deriveBulkMailFields({ headers: { 'list-id': '<x.com>' } }).senderAuthenticated
    ).toBeNull()
  })

  it('is NULL when the header carries no recognizable verdict', () => {
    expect(
      deriveBulkMailFields({ headers: { 'authentication-results': 'mx.google.com; none' } })
        .senderAuthenticated
    ).toBeNull()
    expect(
      deriveBulkMailFields({ headers: { 'authentication-results': '' } }).senderAuthenticated
    ).toBeNull()
  })

  it('is NULL for inconclusive verdicts (none / neutral / temperror)', () => {
    expect(
      deriveBulkMailFields({
        headers: { 'authentication-results': 'mx.example.com; dkim=none; spf=neutral; dmarc=none' },
      }).senderAuthenticated
    ).toBeNull()
    expect(
      deriveBulkMailFields({
        headers: { 'authentication-results': 'mx.example.com; spf=temperror' },
      }).senderAuthenticated
    ).toBeNull()
  })

  it('does not read a lookalike token as a verdict', () => {
    expect(
      deriveBulkMailFields({
        headers: { 'authentication-results': 'mx.example.com; x-dmarc=pass' },
      }).senderAuthenticated
    ).toBeNull()
  })

  it('passes when any of several dkim signatures passes', () => {
    expect(
      deriveBulkMailFields({
        headers: {
          'authentication-results':
            'mx.example.com; dkim=fail header.d=old.example; dkim=pass header.d=acme.com; spf=pass',
        },
      }).senderAuthenticated
    ).toBe(true)
  })
})

describe('deriveBulkMailFields — real-world samples', () => {
  it('Mailchimp campaign', () => {
    expect(
      deriveBulkMailFields({
        fromEmail: 'bounce-mc.us2_123456.7890-customer=example.com@mail123.suw15.mcsv.net',
        headers: {
          'list-id': 'Acme Weekly <acme.us2.list-manage.com>',
          'list-unsubscribe':
            '<https://acme.us2.list-manage.com/unsubscribe?u=1&id=2>, <mailto:unsubscribe@acme.us2.list-manage.com?subject=unsubscribe>',
          'authentication-results':
            'mx.google.com; dkim=pass header.i=@mcsv.net; spf=pass smtp.mailfrom=mail123.suw15.mcsv.net; dmarc=pass header.from=acme.com',
        },
      })
    ).toEqual({
      listId: 'acme.us2.list-manage.com',
      senderDomain: 'mcsv.net',
      unsubscribeMeta: {
        httpUrl: 'https://acme.us2.list-manage.com/unsubscribe?u=1&id=2',
        mailto: 'mailto:unsubscribe@acme.us2.list-manage.com?subject=unsubscribe',
        oneClick: false,
      },
      senderAuthenticated: true,
    })
  })

  it('SendGrid with RFC 8058 one-click', () => {
    expect(
      deriveBulkMailFields({
        fromEmail: 'bounces+9876543-abcd-user=example.com@em1234.acme.io',
        headers: {
          'list-unsubscribe':
            '<https://u1234.ct.sendgrid.net/wf/unsubscribe?upn=abc>, <mailto:unsubscribe@sendgrid.net>',
          'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
          'authentication-results':
            'mx.google.com; dkim=pass header.i=@acme.io; spf=pass; dmarc=pass header.from=acme.io',
        },
      })
    ).toEqual({
      listId: null,
      senderDomain: 'acme.io',
      unsubscribeMeta: {
        httpUrl: 'https://u1234.ct.sendgrid.net/wf/unsubscribe?upn=abc',
        mailto: 'mailto:unsubscribe@sendgrid.net',
        oneClick: true,
      },
      senderAuthenticated: true,
    })
  })

  // Transactional mail: no list-id, so the domain is the only grouping key —
  // exactly why the two columns stay separate (S7 / invariant 8).
  it('Stripe receipt — no list-id, domain grouping only', () => {
    const fields = deriveBulkMailFields({
      fromEmail: 'receipts@stripe.com',
      headers: {
        'authentication-results':
          'mx.google.com; dkim=pass header.i=@stripe.com; spf=pass smtp.mailfrom=bounce.stripe.com; dmarc=pass header.from=stripe.com',
      },
    })
    expect(fields.listId).toBeNull()
    expect(fields.senderDomain).toBe('stripe.com')
    expect(fields.unsubscribeMeta).toBeNull()
    expect(fields.senderAuthenticated).toBe(true)
  })

  it('GitHub notification', () => {
    expect(
      deriveBulkMailFields({
        fromEmail: 'notifications@github.com',
        headers: {
          'list-id': 'acme/widgets <widgets.acme.github.com>',
          'list-unsubscribe':
            '<mailto:unsub+abc123@reply.github.com>, <https://github.com/notifications/unsubscribe-auth/XYZ>',
          'authentication-results':
            'mx.google.com; dkim=pass header.i=@github.com header.s=pf2023; spf=pass; dmarc=pass header.from=github.com',
        },
      })
    ).toEqual({
      listId: 'widgets.acme.github.com',
      senderDomain: 'github.com',
      unsubscribeMeta: {
        httpUrl: 'https://github.com/notifications/unsubscribe-auth/XYZ',
        mailto: 'mailto:unsub+abc123@reply.github.com',
        oneClick: false,
      },
      senderAuthenticated: true,
    })
  })

  // The Outlook/IMAP history shape (§2.3): list-id and list-unsubscribe survive,
  // list-unsubscribe-post and authentication-results never existed. A graceful
  // degrade — the offer falls back to tier 2, it does not silently become tier 1.
  it('Outlook/IMAP history — degrades to no oneClick and unknown auth', () => {
    expect(
      deriveBulkMailFields({
        fromEmail: 'news@mail.acme.com',
        headers: {
          'list-id': '<news.acme.com>',
          'list-unsubscribe': '<https://acme.com/u/1>',
        },
      })
    ).toEqual({
      listId: 'news.acme.com',
      senderDomain: 'acme.com',
      unsubscribeMeta: { httpUrl: 'https://acme.com/u/1', oneClick: false },
      senderAuthenticated: null,
    })
  })
})

describe('deriveBulkMailFields — robustness', () => {
  it('returns all nulls for an empty input', () => {
    expect(deriveBulkMailFields({})).toEqual({
      listId: null,
      senderDomain: null,
      unsubscribeMeta: null,
      senderAuthenticated: null,
    })
  })

  it('tolerates null/undefined headers', () => {
    expect(deriveBulkMailFields({ headers: null, fromEmail: null })).toEqual({
      listId: null,
      senderDomain: null,
      unsubscribeMeta: null,
      senderAuthenticated: null,
    })
  })

  it('ignores non-string header values instead of throwing', () => {
    const headers = {
      'list-id': 42,
      'list-unsubscribe': { nope: true },
      'authentication-results': [],
    } as unknown as Record<string, string>
    expect(deriveBulkMailFields({ headers })).toEqual({
      listId: null,
      senderDomain: null,
      unsubscribeMeta: null,
      senderAuthenticated: null,
    })
  })

  // Ingest must never fail because a sender emitted garbage.
  it('never throws on a hostile header', () => {
    const nasty = `${'<'.repeat(5000)}https://acme.com/u${'>'.repeat(5000)}`
    expect(() =>
      deriveBulkMailFields({
        headers: { 'list-id': nasty, 'list-unsubscribe': nasty, 'authentication-results': nasty },
        fromEmail: `${'a'.repeat(5000)}@${'b'.repeat(5000)}`,
      })
    ).not.toThrow()
  })

  it('is a pure function — the same input derives the same output', () => {
    const input = {
      fromEmail: 'news@mail.acme.com',
      headers: { 'list-id': '<news.acme.com>' },
    }
    expect(deriveBulkMailFields(input)).toEqual(deriveBulkMailFields(input))
  })
})
