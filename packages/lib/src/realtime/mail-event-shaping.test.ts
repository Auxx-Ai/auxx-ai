// packages/lib/src/realtime/mail-event-shaping.test.ts

import { describe, expect, it } from 'vitest'
import type { MailSyncEvent } from './events'
import { shapeMailEventForLens } from './mail-event-shaping'
import { parseInboxRoomKey, rooms } from './room-keys'

const ORG = 'org_abc-123'
const INBOX = 'f6b2c1d0-1111-2222-3333-444455556666'

describe('per-lens inbox room keys', () => {
  it('builds and parses round-trip (UUID slugs contain dashes)', () => {
    const key = rooms.orgInbox(ORG, INBOX, 'subject')
    expect(key).toBe(`org-${ORG}-inbox-${INBOX}-subject`)
    expect(parseInboxRoomKey(key)).toEqual({
      organizationId: ORG,
      inboxSlug: INBOX,
      lens: 'subject',
    })
  })

  it('parses the residual none channel', () => {
    expect(parseInboxRoomKey(rooms.orgInbox(ORG, 'none', 'full'))).toEqual({
      organizationId: ORG,
      inboxSlug: 'none',
      lens: 'full',
    })
  })

  it('rejects legacy un-suffixed keys and bogus lenses', () => {
    expect(parseInboxRoomKey(`org-${ORG}-inbox-${INBOX}`)).toBeNull()
    expect(parseInboxRoomKey(`org-${ORG}-inbox-${INBOX}-admin`)).toBeNull()
    expect(parseInboxRoomKey(`org-${ORG}-events`)).toBeNull()
  })
})

describe('shapeMailEventForLens', () => {
  const threadUpdated: MailSyncEvent = {
    event: 'thread:updated',
    data: {
      threadId: 't1',
      patch: { id: 't1', subject: 'Secret', status: 'OPEN', isUnread: true },
    },
  }

  it('full passes every event through unchanged', () => {
    expect(shapeMailEventForLens(threadUpdated, 'full')).toBe(threadUpdated)
  })

  it('none drops everything', () => {
    expect(shapeMailEventForLens(threadUpdated, 'none')).toBeNull()
  })

  it('subject keeps subject but strips full-only fields from thread patches', () => {
    const shaped = shapeMailEventForLens(threadUpdated, 'subject')
    expect(shaped).not.toBeNull()
    const patch = (shaped as Extract<MailSyncEvent, { event: 'thread:updated' }>).data.patch
    expect(patch.subject).toBe('Secret')
    expect(patch.status).toBe('OPEN')
    expect('isUnread' in patch).toBe(false)
  })

  it('metadata strips the subject too', () => {
    const shaped = shapeMailEventForLens(threadUpdated, 'metadata')
    const patch = (shaped as Extract<MailSyncEvent, { event: 'thread:updated' }>).data.patch
    expect('subject' in patch).toBe(false)
    expect(patch.status).toBe('OPEN')
  })

  it('drops a thread patch that redacts to nothing (per-user unread fanout)', () => {
    const unread: MailSyncEvent = {
      event: 'thread:updated',
      data: { threadId: 't1', patch: { id: 't1', isUnread: false, userId: 'u1' } },
    }
    expect(shapeMailEventForLens(unread, 'subject')).toBeNull()
    expect(shapeMailEventForLens(unread, 'metadata')).toBeNull()
    expect(shapeMailEventForLens(unread, 'full')).toBe(unread)
  })

  it('message events are invisible at metadata, envelope-only at subject', () => {
    const created: MailSyncEvent = {
      event: 'message:created',
      data: { messageId: 'm1', threadId: 't1' },
    }
    expect(shapeMailEventForLens(created, 'metadata')).toBeNull()
    expect(shapeMailEventForLens(created, 'subject')).toBe(created)

    const updated: MailSyncEvent = {
      event: 'message:updated',
      data: {
        messageId: 'm1',
        threadId: 't1',
        patch: { id: 'm1', threadId: 't1', snippet: 'body preview', sendStatus: 'SENT' },
      },
    }
    const shaped = shapeMailEventForLens(updated, 'subject')
    const patch = (shaped as Extract<MailSyncEvent, { event: 'message:updated' }>).data.patch
    expect('snippet' in patch).toBe(false)
    expect(patch.sendStatus).toBe('SENT')
  })

  it('drops a message patch that redacts to nothing', () => {
    const contentOnly: MailSyncEvent = {
      event: 'message:updated',
      data: {
        messageId: 'm1',
        threadId: 't1',
        patch: { id: 'm1', threadId: 't1', attachments: [] },
      },
    }
    expect(shapeMailEventForLens(contentOnly, 'subject')).toBeNull()
  })

  it('shapes mail:batch recursively and drops empty frames', () => {
    const batch: MailSyncEvent = {
      event: 'mail:batch',
      data: {
        events: [
          { event: 'message:created', data: { messageId: 'm1', threadId: 't1' } },
          { event: 'thread:deleted', data: { threadId: 't2' } },
        ],
      },
    }
    const atMetadata = shapeMailEventForLens(batch, 'metadata')
    expect(atMetadata).toEqual({
      event: 'mail:batch',
      data: { events: [{ event: 'thread:deleted', data: { threadId: 't2' } }] },
    })

    const messagesOnly: MailSyncEvent = {
      event: 'mail:batch',
      data: { events: [{ event: 'message:created', data: { messageId: 'm1', threadId: 't1' } }] },
    }
    expect(shapeMailEventForLens(messagesOnly, 'metadata')).toBeNull()
  })

  it('metadata-tier events pass through at every visible lens', () => {
    const participant: MailSyncEvent = {
      event: 'participant:updated',
      data: { participantId: 'p1', patch: { id: 'p1', name: 'Bob' } },
    }
    expect(shapeMailEventForLens(participant, 'metadata')).toBe(participant)
    const sync: MailSyncEvent = { event: 'inbox:syncCompleted', data: { inboxId: INBOX } }
    expect(shapeMailEventForLens(sync, 'metadata')).toBe(sync)
  })
})
