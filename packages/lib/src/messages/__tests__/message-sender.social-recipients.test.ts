// packages/lib/src/messages/__tests__/message-sender.social-recipients.test.ts
//
// Direct unit coverage of `resolveRecipients`, the private helper that gives a
// `thread_only` channel (Messenger, Instagram Direct) its outbound recipient.
// Those channels have no recipient field anywhere — the composer sends `to: []`
// and `requiresRecipients` is false — so the address comes from the thread key
// `socialThreadKey` minted at ingest. Without this the provider threw
// "Recipient PSID (Page-Scoped ID) is required in 'to' field" and no reply ever
// reached Messenger.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock(),
    IntegrationProviderTypeValues: ['google', 'outlook', 'email', 'mailgun', 'imap'],
  }
})

import { MessageSenderService } from '../message-sender.service'

function createService(): any {
  return new MessageSenderService('org-1')
}

const DM_KEY = 'dm:869289333164075:27893553143563440'

describe('resolveRecipients', () => {
  it('derives the Messenger counterpart from the thread key when `to` is empty', () => {
    expect(createService().resolveRecipients({ to: [] }, 'facebook', DM_KEY)).toEqual([
      { identifier: '27893553143563440', identifierType: 'FACEBOOK_PSID' },
    ])
  })

  it('types an Instagram recipient as IGSID, not PSID', () => {
    // The two channels share a thread-key format but not an id space; a wrong
    // type forks the participant identity even when the send succeeds.
    expect(createService().resolveRecipients({ to: [] }, 'instagram', DM_KEY)).toEqual([
      { identifier: '27893553143563440', identifierType: 'INSTAGRAM_IGSID' },
    ])
  })

  it('never overrides an explicit recipient address', () => {
    const to = [{ identifier: '999', identifierType: 'FACEBOOK_PSID' }]
    expect(createService().resolveRecipients({ to }, 'facebook', DM_KEY)).toEqual(to)
  })

  it('corrects an id space the caller guessed wrong on a thread_only channel', () => {
    // The workflow answer node resolves the right identifier off the thread but
    // labels every recipient EMAIL. On Messenger there is only one id space, so
    // that label is wrong rather than a choice — left alone it forks a second
    // participant for a person ingest already has.
    expect(
      createService().resolveRecipients(
        { to: [{ identifier: '27893553143563440', identifierType: 'EMAIL' }] },
        'facebook',
        DM_KEY
      )
    ).toEqual([{ identifier: '27893553143563440', identifierType: 'FACEBOOK_PSID' }])
  })

  it('leaves a correctly-typed recipient untouched', () => {
    const to = [{ identifier: '27893553143563440', identifierType: 'FACEBOOK_PSID' }]
    expect(createService().resolveRecipients({ to }, 'facebook', DM_KEY)[0]).toBe(to[0])
  })

  it('never rewrites the id space on an email channel', () => {
    const to = [{ identifier: 'customer@example.com', identifierType: 'EMAIL' }]
    expect(createService().resolveRecipients({ to }, 'google', DM_KEY)).toBe(to)
  })

  it('leaves email channels alone — they are not thread_only', () => {
    // Email must keep failing loudly on an empty recipient list rather than
    // silently addressing whatever the thread id happens to look like.
    expect(createService().resolveRecipients({ to: [] }, 'google', DM_KEY)).toEqual([])
  })

  it('leaves chat alone — its counterpart is encoded on the Thread, not the key', () => {
    expect(createService().resolveRecipients({ to: [] }, 'chat', DM_KEY)).toEqual([])
  })

  it.each([
    ['a comment thread', 'comment:1234567890'],
    ['a pending/placeholder thread', undefined],
    ['a null external id', null],
    ['a provider conversation id', 't_1234567890'],
  ])('returns an empty list for %s rather than guessing', (_label, externalId) => {
    expect(createService().resolveRecipients({ to: [] }, 'facebook', externalId)).toEqual([])
  })
})
