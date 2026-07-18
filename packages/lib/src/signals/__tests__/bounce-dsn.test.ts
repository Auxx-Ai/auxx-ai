// packages/lib/src/signals/__tests__/bounce-dsn.test.ts
// Fixtures mirror the real 2026-07-18 incident NDRs (Gmail + Microsoft) plus the
// transient/no-code cases the plan (§4) says must NOT suppress.

import { describe, expect, it } from 'vitest'
import { isDeliveryStatusNotification, parseBounceDsn } from '../bounce-dsn'

describe('parseBounceDsn', () => {
  it('(a) Gmail NDR — permanent, recipient from X-Failed-Recipients', () => {
    const result = parseBounceDsn({
      headers: {
        'auto-submitted': 'auto-replied',
        'return-path': '<>',
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        'x-failed-recipients': 'legal@notifications.resend.com',
        'content-type': 'multipart/report; boundary="000000000000abc"; report-type=delivery-status',
      },
      fromEmail: 'mailer-daemon@googlemail.com',
      textPlain:
        "Address not found. Your message wasn't delivered to legal@notifications.resend.com " +
        "because the address couldn't be found, or is unable to receive mail.\n\n" +
        'The response was:\n550 5.1.1 The email account that you tried to reach does not exist.',
    })

    expect(result.isDsn).toBe(true)
    expect(result.permanent).toBe(true)
    expect(result.statusCode).toBe('5.1.1')
    expect(result.failedRecipient).toBe('legal@notifications.resend.com')
  })

  it('(a2) Gmail NDR — recipient falls back to body phrase when header absent', () => {
    const result = parseBounceDsn({
      headers: {
        'return-path': '<>',
        'content-type': 'multipart/report; report-type=delivery-status',
      },
      fromEmail: 'mailer-daemon@googlemail.com',
      textPlain:
        "Your message wasn't delivered to legal@notifications.resend.com because the address " +
        "couldn't be found.\n550 5.1.1 does not exist",
    })

    expect(result.failedRecipient).toBe('legal@notifications.resend.com')
    expect(result.permanent).toBe(true)
  })

  it('(b) Microsoft NDR — permanent (554 5.2.2 mailbox full), no X-Failed-Recipients', () => {
    const result = parseBounceDsn({
      headers: {
        from: '<postmaster@microsoft.com>',
        'content-type': 'multipart/report; report-type=delivery-status',
      },
      fromEmail: 'postmaster@microsoft.com',
      textPlain:
        'Delivery has failed to these recipients or groups:\n\n' +
        "notifications@github.com\nThe recipient's mailbox is full and can't accept messages now. " +
        'Please try resending your message later, or contact the recipient directly.\n\n' +
        'Diagnostic information for administrators:\n554 5.2.2 mailbox full',
    })

    expect(result.isDsn).toBe(true)
    expect(result.permanent).toBe(true)
    expect(result.statusCode).toBe('5.2.2')
    expect(result.failedRecipient).toBe('notifications@github.com')
  })

  it('(c) Gmail delay — NOT permanent (4.x.x, retry pending)', () => {
    const result = parseBounceDsn({
      headers: {
        'return-path': '<>',
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        subject: 'Delivery Status Notification (Delay)',
        'content-type': 'multipart/report; report-type=delivery-status',
      },
      fromEmail: 'mailer-daemon@googlemail.com',
      textPlain:
        'There was a temporary problem delivering your message to user@example.com. ' +
        'Gmail will retry for 24 hours.\n\n421 4.7.0 Try again later.',
    })

    expect(result.isDsn).toBe(true)
    expect(result.permanent).toBe(false)
    expect(result.statusCode).toBe('4.7.0')
  })

  it('(d) NDR with no status code at all — NOT permanent', () => {
    const result = parseBounceDsn({
      headers: {
        'return-path': '<>',
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        'content-type': 'multipart/report; report-type=delivery-status',
      },
      fromEmail: 'mailer-daemon@googlemail.com',
      textPlain:
        "Your message wasn't delivered to someone@example.com. The address couldn't be found.",
    })

    expect(result.isDsn).toBe(true)
    expect(result.permanent).toBe(false)
    expect(result.statusCode).toBeNull()
    expect(result.failedRecipient).toBe('someone@example.com')
  })

  it('extracts recipient from Final-Recipient DSN line', () => {
    const result = parseBounceDsn({
      headers: { 'content-type': 'multipart/report; report-type=delivery-status' },
      textPlain: 'Final-Recipient: rfc822; blocked@example.org\nAction: failed\nStatus: 5.7.1\n',
    })

    expect(result.failedRecipient).toBe('blocked@example.org')
    expect(result.permanent).toBe(true)
    expect(result.statusCode).toBe('5.7.1')
  })

  it('picks up original Message-IDs from In-Reply-To / References + embedded body', () => {
    const result = parseBounceDsn({
      headers: {
        'in-reply-to': '<orig-123@mail.auxx.ai>',
        references: '<thread-1@mail.auxx.ai> <orig-123@mail.auxx.ai>',
        'content-type': 'multipart/report; report-type=delivery-status',
      },
      textPlain: 'Original message headers:\nMessage-ID: <orig-123@mail.auxx.ai>\n550 5.1.1',
    })

    expect(result.originalMessageIds).toContain('orig-123@mail.auxx.ai')
    expect(result.originalMessageIds).toContain('thread-1@mail.auxx.ai')
  })

  it('classifies permanent when only a bare SMTP 5xx code is present', () => {
    const result = parseBounceDsn({
      headers: { 'content-type': 'multipart/report' },
      textPlain: 'The mail server returned: 550 mailbox unavailable',
    })

    expect(result.permanent).toBe(true)
    expect(result.statusCode).toBe('550')
  })

  it('non-DSN hard machine mail (plain auto-generated) is not a DSN', () => {
    const result = parseBounceDsn({
      headers: { 'auto-submitted': 'auto-generated', from: 'alerts@service.com' },
      fromEmail: 'alerts@service.com',
      textPlain: 'Your scheduled report is ready. Nothing bounced here.',
    })

    expect(result.isDsn).toBe(false)
    expect(result.permanent).toBe(false)
  })

  it('isDeliveryStatusNotification flags a null return-path even without body cues', () => {
    expect(isDeliveryStatusNotification({ headers: { 'return-path': '<>' } })).toBe(true)
  })

  it('finds the diagnostic in HTML even when textPlain is the returned original (real Microsoft NDR shape)', () => {
    // Verified against the 2026-07-18 incident: Exchange NDRs put OUR original
    // reply in textPlain and the failure text + status code only in the HTML part.
    const result = parseBounceDsn({
      headers: {
        from: '<postmaster@microsoft.com>',
        'return-path': '<>',
        'auto-submitted': 'auto-replied',
        'content-type': 'multipart/report; report-type=delivery-status; boundary="abc"',
      },
      fromEmail: 'postmaster@microsoft.com',
      textPlain:
        "Hi there,\r\n\r\nThank you for reaching out!\r\n\r\nI wasn't able to locate an order number in your message.\r\n",
      textHtml:
        '<html><body><p>Delivery has failed to these recipients or groups:</p>' +
        '<a href="mailto:notifications@github.com">notifications@github.com</a>' +
        "<p>The recipient's mailbox is full and can't accept messages now.</p>" +
        '<p>Diagnostic information for administrators:</p>' +
        '<p>Remote server returned 554 5.2.2 mailbox full</p></body></html>',
    })

    expect(result.isDsn).toBe(true)
    expect(result.failedRecipient).toBe('notifications@github.com')
    expect(result.permanent).toBe(true)
    expect(result.statusCode).toBe('5.2.2')
  })

  it('parses recipient/status from stripped HTML when textPlain is absent', () => {
    const result = parseBounceDsn({
      headers: { 'content-type': 'multipart/report; report-type=delivery-status' },
      textHtml:
        "<html><body><p>Your message wasn't delivered to <b>gone@example.com</b> " +
        'because the address could not be found.</p><p>550 5.1.1 no such user</p></body></html>',
    })

    expect(result.failedRecipient).toBe('gone@example.com')
    expect(result.permanent).toBe(true)
  })
})
