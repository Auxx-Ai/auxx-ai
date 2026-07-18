// packages/lib/src/ingest/filtering/__tests__/machine-mail.test.ts

import { describe, expect, it } from 'vitest'
import { detectMachineMail, pickMachineMailHeaders } from '../machine-mail'

describe('detectMachineMail', () => {
  describe('hard tier', () => {
    it('flags content-type report-type=delivery-status', () => {
      const result = detectMachineMail({
        headers: {
          'content-type': 'multipart/report; report-type=delivery-status; boundary="abc"',
        },
        fromEmail: 'postmaster@microsoft.com',
      })
      expect(result).toEqual({ tier: 'hard', reason: 'delivery-status' })
    })

    it('flags multipart/report content-type even without report-type param', () => {
      const result = detectMachineMail({
        headers: { 'content-type': 'multipart/report; boundary="xyz"' },
        fromEmail: 'mailer-daemon@example.com',
      })
      expect(result).toEqual({ tier: 'hard', reason: 'delivery-status' })
    })

    it('flags an empty return-path (null return path)', () => {
      const result = detectMachineMail({
        headers: { 'return-path': '' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'hard', reason: 'null-return-path' })
    })

    it('flags a "<>" return-path (null return path)', () => {
      const result = detectMachineMail({
        headers: { 'return-path': '<>' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'hard', reason: 'null-return-path' })
    })

    it.each([
      'mailer-daemon@example.com',
      'postmaster@microsoft.com',
      'mailer@example.com',
      'bounce@example.com',
      'bounces@example.com',
      'BOUNCE@example.com',
      'bounce+abc123@example.com',
      'bounces+xyz@example.com',
    ])('flags hard machine sender localpart: %s', (fromEmail) => {
      const result = detectMachineMail({ headers: {}, fromEmail })
      expect(result).toEqual({ tier: 'hard', reason: 'machine-sender' })
    })

    it('flags auto-submitted: auto-generated as hard', () => {
      const result = detectMachineMail({
        headers: { 'auto-submitted': 'auto-generated' },
        fromEmail: 'ci-bot@github.com',
      })
      expect(result).toEqual({ tier: 'hard', reason: 'auto-submitted' })
    })

    it('flags an unknown non-"no" auto-submitted value as hard', () => {
      const result = detectMachineMail({
        headers: { 'auto-submitted': 'auto-forwarded' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'hard', reason: 'auto-submitted' })
    })

    it('handles array header values by taking the first entry', () => {
      const result = detectMachineMail({
        headers: { 'auto-submitted': ['auto-generated', 'no'] },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'hard', reason: 'auto-submitted' })
    })
  })

  describe('soft tier', () => {
    it('flags auto-submitted: auto-replied (OOO) as soft', () => {
      const result = detectMachineMail({
        headers: { 'auto-submitted': 'auto-replied' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'soft', reason: 'auto-replied' })
    })

    it('flags list-id headers', () => {
      const result = detectMachineMail({
        headers: { 'list-id': '<updates.example.com>' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'soft', reason: 'mailing-list' })
    })

    it('flags list-unsubscribe headers', () => {
      const result = detectMachineMail({
        headers: { 'list-unsubscribe': '<mailto:unsub@example.com>' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'soft', reason: 'mailing-list' })
    })

    it.each(['bulk', 'list', 'junk', 'BULK', 'List'])('flags precedence: %s', (precedenceValue) => {
      const result = detectMachineMail({
        headers: { precedence: precedenceValue },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'soft', reason: 'precedence' })
    })

    it('flags x-auto-response-suppress with a non-none token', () => {
      const result = detectMachineMail({
        headers: { 'x-auto-response-suppress': 'OOF' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'soft', reason: 'auto-response-suppress' })
    })

    it('flags x-auto-response-suppress with mixed tokens including non-none', () => {
      const result = detectMachineMail({
        headers: { 'x-auto-response-suppress': 'DR, RN, NRN' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'soft', reason: 'auto-response-suppress' })
    })

    it.each([
      'no-reply@example.com',
      'noreply@example.com',
      'do-not-reply@example.com',
      'donotreply@example.com',
      'no-reply+campaign@example.com',
      'noreply+alerts@example.com',
    ])('flags soft no-reply sender localpart: %s', (fromEmail) => {
      const result = detectMachineMail({ headers: {}, fromEmail })
      expect(result).toEqual({ tier: 'soft', reason: 'no-reply-sender' })
    })
  })

  describe('does not flag', () => {
    it('does not flag auto-submitted: no', () => {
      const result = detectMachineMail({
        headers: { 'auto-submitted': 'no' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toBeNull()
    })

    it('does not flag precedence: first-class', () => {
      const result = detectMachineMail({
        headers: { precedence: 'first-class' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toBeNull()
    })

    it('does not flag when return-path is absent entirely', () => {
      const result = detectMachineMail({
        headers: { subject: 'Hello' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toBeNull()
    })

    it('does not flag a populated return-path', () => {
      const result = detectMachineMail({
        headers: { 'return-path': '<jane@example.com>' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toBeNull()
    })

    it('does not flag plain human mail with ordinary headers', () => {
      const result = detectMachineMail({
        headers: {
          subject: 'Question about my order',
          from: 'Jane Doe <jane@example.com>',
          'content-type': 'text/plain; charset=UTF-8',
          'return-path': '<jane@example.com>',
        },
        fromEmail: 'jane@example.com',
      })
      expect(result).toBeNull()
    })

    it('does not flag when headers and fromEmail are both absent', () => {
      const result = detectMachineMail({})
      expect(result).toBeNull()
    })
  })

  // Real-incident fixtures (2026-07-18, real headers from dev DB). See
  // plans/signals/05-machine-mail-bounce.md evidence table.
  describe('real-incident fixtures', () => {
    it('(a) GitHub "PR run failed" notification → soft', () => {
      const result = detectMachineMail({
        headers: {
          precedence: 'list',
          'list-id': 'auxx-ai/auxx <auxx.github.com>',
          'return-path': '<notifications@github.com>',
        },
        fromEmail: 'notifications@github.com',
      })
      expect(result?.tier).toBe('soft')
    })

    it('(b) Resend "subprocessors update" notice → soft', () => {
      const result = detectMachineMail({
        headers: {
          precedence: 'bulk',
          'list-unsubscribe': '<https://resend.com/unsubscribe/abc123>',
          'return-path': '<bounces+7890-abc@resend.dev>',
        },
        fromEmail: 'updates@resend.com',
      })
      expect(result?.tier).toBe('soft')
    })

    it('(c) Gmail NDR → hard', () => {
      const result = detectMachineMail({
        headers: {
          'auto-submitted': 'auto-replied',
          'return-path': '<>',
          'content-type': 'multipart/report; boundary="000000"; report-type=delivery-status',
        },
        fromEmail: 'mailer-daemon@googlemail.com',
      })
      expect(result?.tier).toBe('hard')
    })

    it('(d) Microsoft NDR → hard', () => {
      const result = detectMachineMail({
        headers: {
          'auto-submitted': 'auto-replied',
          'return-path': '<>',
          'content-type': 'multipart/report; report-type=delivery-status; boundary="000001"',
        },
        fromEmail: 'postmaster@microsoft.com',
      })
      expect(result?.tier).toBe('hard')
    })

    it('(e) x-auto-response-suppress: "None" alone → null', () => {
      const result = detectMachineMail({
        headers: { 'x-auto-response-suppress': 'None' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toBeNull()
    })

    it('(f) x-auto-response-suppress: "All" alone → soft', () => {
      const result = detectMachineMail({
        headers: { 'x-auto-response-suppress': 'All' },
        fromEmail: 'jane@example.com',
      })
      expect(result).toEqual({ tier: 'soft', reason: 'auto-response-suppress' })
    })
  })
})

describe('pickMachineMailHeaders', () => {
  it('picks the allowlisted subset from Graph-shaped {name, value} entries', () => {
    const picked = pickMachineMailHeaders([
      { name: 'Return-Path', value: '<>' },
      { name: 'X-Auto-Response-Suppress', value: 'All' },
      { name: 'Received', value: 'from mx.example.com' },
      { name: 'Subject', value: 'Undeliverable: hi' },
    ])
    expect(picked).toEqual({ 'return-path': '<>', 'x-auto-response-suppress': 'All' })
  })

  it('picks from postal-mime-shaped {key, value} entries', () => {
    const picked = pickMachineMailHeaders([
      { key: 'list-unsubscribe', value: '<mailto:unsub@example.com>' },
      { key: 'x-spam-score', value: '0.1' },
    ])
    expect(picked).toEqual({ 'list-unsubscribe': '<mailto:unsub@example.com>' })
  })

  it('keeps the first occurrence of a duplicated header', () => {
    const picked = pickMachineMailHeaders([
      { name: 'Precedence', value: 'bulk' },
      { name: 'Precedence', value: 'list' },
    ])
    expect(picked).toEqual({ precedence: 'bulk' })
  })

  it('returns undefined when nothing allowlisted is present', () => {
    expect(pickMachineMailHeaders([{ name: 'Subject', value: 'hello' }])).toBeUndefined()
    expect(pickMachineMailHeaders([])).toBeUndefined()
    expect(pickMachineMailHeaders(undefined)).toBeUndefined()
  })

  it('round-trips into detectMachineMail (Outlook NDR shape)', () => {
    const headers = pickMachineMailHeaders([
      { name: 'Content-Type', value: 'multipart/report; report-type=delivery-status' },
      { name: 'Auto-Submitted', value: 'auto-replied' },
    ])
    const result = detectMachineMail({ headers, fromEmail: 'postmaster@outlook.com' })
    expect(result?.tier).toBe('hard')
  })
})
