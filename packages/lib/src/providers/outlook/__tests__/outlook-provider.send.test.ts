// packages/lib/src/providers/outlook/__tests__/outlook-provider.send.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendMessageOptions } from '../../channel-provider.interface'
import { OutlookProvider } from '../outlook-provider'

/**
 * Every call recorded off the fake Graph client, so a test can assert on the exact
 * payload handed to `/me/sendMail` rather than on our own intermediate state.
 */
interface RecordedPost {
  path: string
  body: any
}

interface GraphHeader {
  name: string
  value: string
}

function makeProvider() {
  const posts: RecordedPost[] = []
  const provider = new OutlookProvider('org_1')
  provider.integrationId = 'int_1'
  ;(provider as any).integration = {
    id: 'int_1',
    metadata: { email: 'us@example.com', emailAliases: [] },
  }
  ;(provider as any).client = {
    api: (path: string) => ({
      post: async (body: any) => {
        posts.push({ path, body })
        return { id: 'graph_draft_1' }
      },
    }),
  }
  // The real one hits the DB to upsert contacts for recipients; irrelevant here.
  ;(provider as any).storageService = {
    ensureContactsForRecipients: vi.fn().mockResolvedValue(undefined),
    setInitialSyncMode: vi.fn(),
  }
  return { provider, posts }
}

function baseOptions(overrides: Partial<SendMessageOptions> = {}): SendMessageOptions {
  return {
    from: 'us@example.com',
    to: ['them@example.com'],
    subject: 'Re: Hello',
    html: '<p>hello</p>',
    ...overrides,
  }
}

function headersOf(posts: RecordedPost[]): GraphHeader[] {
  const sendMail = posts.find((p) => p.path === '/me/sendMail')
  expect(sendMail).toBeDefined()
  return sendMail?.body?.message?.internetMessageHeaders ?? []
}

describe('OutlookProvider.sendMessage — internetMessageHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stamps X-AuxxAi-Message-Id with our own Message.id', async () => {
    const { provider, posts } = makeProvider()

    const result = await provider.sendMessage(
      baseOptions({ internalMessageId: 'cm_local_row_123' })
    )

    expect(result.success).toBe(true)
    expect(headersOf(posts)).toContainEqual({
      name: 'X-AuxxAi-Message-Id',
      value: 'cm_local_row_123',
    })
  })

  it('omits X-AuxxAi-Message-Id when no local message id is supplied', async () => {
    const { provider, posts } = makeProvider()

    await provider.sendMessage(baseOptions())

    const names = headersOf(posts).map((h) => h.name.toLowerCase())
    expect(names).not.toContain('x-auxxai-message-id')
    // The unconditional marker still rides along.
    expect(names).toContain('x-auxxai-message')
  })

  it('never posts a header whose name is not x- prefixed', async () => {
    // Regression guard for the 400 InvalidInternetMessageHeader outage: Graph rejects
    // the WHOLE request for any non-`x-` custom header name, so a single stray header
    // breaks every Outlook send rather than being silently dropped.
    const { provider, posts } = makeProvider()

    await provider.sendMessage(
      baseOptions({
        internalMessageId: 'cm_local_row_123',
        automated: true,
        inReplyTo: '<parent@example.com>',
        references: '<root@example.com> <parent@example.com>',
        unsubscribe: { url: 'https://auxx.ai/u/tok' },
      })
    )

    const headers = headersOf(posts)
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header.name.toLowerCase().startsWith('x-')).toBe(true)
    }
  })

  it('does not emit In-Reply-To/References even when threading options are set', async () => {
    const { provider, posts } = makeProvider()

    await provider.sendMessage(
      baseOptions({
        inReplyTo: '<parent@example.com>',
        references: '<root@example.com> <parent@example.com>',
      })
    )

    const names = headersOf(posts).map((h) => h.name.toLowerCase())
    expect(names).not.toContain('in-reply-to')
    expect(names).not.toContain('references')
  })

  it('emits X-Auto-Response-Suppress for automated sends only', async () => {
    const automated = makeProvider()
    await automated.provider.sendMessage(baseOptions({ automated: true }))
    expect(headersOf(automated.posts)).toContainEqual({
      name: 'X-Auto-Response-Suppress',
      value: 'All',
    })

    const human = makeProvider()
    await human.provider.sendMessage(baseOptions())
    expect(headersOf(human.posts).map((h) => h.name.toLowerCase())).not.toContain(
      'x-auto-response-suppress'
    )
  })
})

describe('OutlookProvider — echoedMessageId round trip', () => {
  /**
   * `convertMessagesToMessageData` is private and every public entry point to it
   * (syncMessages / importMessages) requires a paged Graph client plus the full
   * storage pipeline. Calling the mapper directly on a fully-populated instance is
   * the smallest seam that still exercises the real header-reading code.
   */
  function mapOne(graphMessage: Record<string, unknown>) {
    const { provider } = makeProvider()
    const [messageData] = (provider as any).convertMessagesToMessageData([
      {
        id: 'graph_msg_1',
        conversationId: 'conv_1',
        subject: 'Re: Hello',
        from: { emailAddress: { address: 'us@example.com', name: 'Us' } },
        toRecipients: [{ emailAddress: { address: 'them@example.com' } }],
        sentDateTime: '2026-08-01T05:40:33Z',
        receivedDateTime: '2026-08-01T05:41:50Z',
        body: { contentType: 'html', content: '<p>hello</p>' },
        internetMessageId: '<SA1PR19MB7062@example.com>',
        parentFolderId: 'sentitems',
        ...graphMessage,
      },
    ])
    return messageData
  }

  it('reads X-AuxxAi-Message-Id back off the Sent Items copy', () => {
    const messageData = mapOne({
      internetMessageHeaders: [{ name: 'X-AuxxAi-Message-Id', value: 'cm_local_row_123' }],
    })
    expect(messageData.echoedMessageId).toBe('cm_local_row_123')
  })

  it('matches the header name case-insensitively', () => {
    // Graph guarantees the `x-` prefix round-trips, not the casing it returns.
    expect(
      mapOne({
        internetMessageHeaders: [{ name: 'x-auxxai-message-id', value: 'cm_local_row_123' }],
      }).echoedMessageId
    ).toBe('cm_local_row_123')

    expect(
      mapOne({
        internetMessageHeaders: [{ name: 'X-AUXXAI-MESSAGE-ID', value: 'cm_local_row_123' }],
      }).echoedMessageId
    ).toBe('cm_local_row_123')
  })

  it('is null when the header is absent, empty, or there are no headers at all', () => {
    expect(mapOne({}).echoedMessageId).toBeNull()
    expect(mapOne({ internetMessageHeaders: [] }).echoedMessageId).toBeNull()
    expect(
      mapOne({
        internetMessageHeaders: [
          { name: 'X-AuxxAi-Message', value: 'true' },
          { name: 'In-Reply-To', value: '<parent@example.com>' },
        ],
      }).echoedMessageId
    ).toBeNull()
    expect(
      mapOne({ internetMessageHeaders: [{ name: 'X-AuxxAi-Message-Id', value: '  ' }] })
        .echoedMessageId
    ).toBeNull()
  })

  it('does not persist the echoed id into metadata.headers', () => {
    const messageData = mapOne({
      internetMessageHeaders: [{ name: 'X-AuxxAi-Message-Id', value: 'cm_local_row_123' }],
    })
    expect(JSON.stringify(messageData.metadata?.headers ?? {})).not.toContain('cm_local_row_123')
  })
})
