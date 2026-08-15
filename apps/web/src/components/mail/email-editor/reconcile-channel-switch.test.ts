// apps/web/src/components/mail/email-editor/reconcile-channel-switch.test.ts
//
// Phase 1 of the composer capability plan. The bug being guarded: switching the
// From channel from email to SMS left email addresses in `state.to` and merely
// HID subject/cc/bcc — they stayed in state and were still submitted. So every
// assertion here is on the returned VALUES, never on a render flag.

import { IdentifierType } from '@auxx/database/enums'
import type { ComposerCapabilities } from '@auxx/lib/channels/client'
import { describe, expect, it } from 'vitest'
import { getIdentifierModel } from './identifier-model'
import { smsLength } from './message-length'
import { formatDroppedList, reconcileDraftForChannel } from './reconcile-channel-switch'
import type { RecipientState, Recipients } from './types'

const EMAIL_CAPS: ComposerCapabilities = {
  channel: 'email',
  newOutbound: true,
  threadReply: true,
  subject: true,
  ccBcc: true,
  attachments: true,
  recipientModel: 'email',
  richText: true,
  signature: true,
}

const SMS_CAPS: ComposerCapabilities = {
  channel: 'messaging',
  newOutbound: true,
  threadReply: true,
  subject: false,
  ccBcc: false,
  attachments: false,
  recipientModel: 'phone',
  richText: false,
  signature: false,
  maxMessageLength: 1600,
}

const mailto = (identifier: string): RecipientState => ({
  id: identifier,
  identifier,
  identifierType: IdentifierType.EMAIL,
  name: null,
})

const tel = (identifier: string): RecipientState => ({
  id: identifier,
  identifier,
  identifierType: IdentifierType.PHONE,
  name: null,
})

const recipients = (over: Partial<Recipients> = {}): Recipients => ({
  TO: [],
  CC: [],
  BCC: [],
  ...over,
})

describe('reconcileDraftForChannel — email → SMS', () => {
  const fullEmailDraft = {
    recipients: recipients({
      TO: [mailto('a@example.com'), mailto('b@example.com')],
      CC: [mailto('c@example.com')],
      BCC: [mailto('d@example.com')],
    }),
    subject: 'Order #1234',
    signatureId: 'sig_1',
    attachmentCount: 2,
  }

  const outcome = () =>
    reconcileDraftForChannel({
      draft: fullEmailDraft,
      incoming: SMS_CAPS,
      spec: getIdentifierModel('phone'),
    })

  it('drops every email address — none of them normalize as a phone number', () => {
    expect(outcome().recipients).toEqual({ TO: [], CC: [], BCC: [] })
  })

  it('CLEARS the subject rather than hiding it', () => {
    expect(outcome().subject).toBe('')
  })

  it('clears the signature', () => {
    expect(outcome().signatureId).toBeNull()
  })

  it('asks the caller to clear attachments', () => {
    expect(outcome().clearAttachments).toBe(true)
  })

  it('names everything it dropped, exactly once', () => {
    expect(outcome().dropped).toEqual([
      '4 recipients',
      'the subject',
      'the signature',
      '2 attachments',
    ])
  })
})

describe('reconcileDraftForChannel — partitioning', () => {
  it('keeps recipients the incoming channel can address and rewrites them', () => {
    const result = reconcileDraftForChannel({
      draft: {
        // A contact picked by name can already carry a phone in `identifier`.
        recipients: recipients({ TO: [mailto('bob@example.com'), tel('(415) 555-2671')] }),
        subject: '',
        signatureId: null,
        attachmentCount: 0,
      },
      incoming: SMS_CAPS,
      spec: getIdentifierModel('phone'),
    })

    expect(result.recipients.TO).toHaveLength(1)
    // Survivors are canonicalized AND re-typed — an `EMAIL` identifierType on an
    // SMS send would mis-route the participant lookup.
    expect(result.recipients.TO[0]?.identifier).toBe('+14155552671')
    expect(result.recipients.TO[0]?.identifierType).toBe(IdentifierType.PHONE)
    expect(result.dropped).toEqual(['1 recipient'])
  })

  it('drops phone numbers when switching SMS → email', () => {
    const result = reconcileDraftForChannel({
      draft: {
        recipients: recipients({ TO: [tel('+14155552671')] }),
        subject: '',
        signatureId: null,
        attachmentCount: 0,
      },
      incoming: EMAIL_CAPS,
      spec: getIdentifierModel('email'),
    })

    expect(result.recipients.TO).toEqual([])
    expect(result.dropped).toEqual(['1 recipient'])
  })

  it('keeps cc/bcc when the incoming channel supports them', () => {
    const result = reconcileDraftForChannel({
      draft: {
        recipients: recipients({ CC: [mailto('c@example.com')], BCC: [mailto('d@example.com')] }),
        subject: 'kept',
        signatureId: 'sig_1',
        attachmentCount: 1,
      },
      incoming: EMAIL_CAPS,
      spec: getIdentifierModel('email'),
    })

    expect(result.recipients.CC).toHaveLength(1)
    expect(result.recipients.BCC).toHaveLength(1)
    expect(result.subject).toBe('kept')
    expect(result.signatureId).toBe('sig_1')
    expect(result.clearAttachments).toBe(false)
    expect(result.dropped).toEqual([])
  })
})

describe('reconcileDraftForChannel — nothing to report', () => {
  it('says nothing when the draft was empty', () => {
    const result = reconcileDraftForChannel({
      draft: { recipients: recipients(), subject: '   ', signatureId: null, attachmentCount: 0 },
      incoming: SMS_CAPS,
      spec: getIdentifierModel('phone'),
    })

    expect(result.dropped).toEqual([])
    expect(result.clearAttachments).toBe(false)
  })
})

describe('formatDroppedList', () => {
  it.each([
    [[], ''],
    [['3 recipients'], '3 recipients'],
    [['3 recipients', 'the subject'], '3 recipients and the subject'],
    [['3 recipients', 'the subject', '1 attachment'], '3 recipients, the subject and 1 attachment'],
  ])('%j → %s', (input, expected) => {
    expect(formatDroppedList(input)).toBe(expected)
  })
})

describe('smsLength', () => {
  it('is empty for an empty body', () => {
    expect(smsLength('')).toEqual({ characters: 0, segments: 0, unicode: false })
  })

  it('fits 160 GSM characters in one segment', () => {
    expect(smsLength('a'.repeat(160))).toEqual({ characters: 160, segments: 1, unicode: false })
  })

  it('spills to 153-character segments past one', () => {
    expect(smsLength('a'.repeat(161)).segments).toBe(2)
    expect(smsLength('a'.repeat(306)).segments).toBe(2)
    expect(smsLength('a'.repeat(307)).segments).toBe(3)
  })

  it('halves the segment size as soon as one non-GSM character appears', () => {
    // The single emoji is what does it — 71 GSM characters would still be 1
    // segment at 160.
    const body = `${'a'.repeat(70)}🎉`
    expect(smsLength(body).unicode).toBe(true)
    expect(smsLength(body).segments).toBe(2)
    expect(smsLength('a'.repeat(71))).toEqual({ characters: 71, segments: 1, unicode: false })
  })

  it('treats the GSM extension table as GSM', () => {
    expect(smsLength('cost: €5 [approx]').unicode).toBe(false)
  })

  it('treats a curly quote as unicode', () => {
    expect(smsLength('don’t').unicode).toBe(true)
  })
})
