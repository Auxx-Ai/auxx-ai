// packages/lib/src/providers/openphone/__tests__/openphone-provider.test.ts
//
// Covers the three things the Quo rewrite can get silently wrong:
//   1. `setupWebhook` must create the webhook ENABLED (Quo webhooks are immutable — there is no
//      update call to flip one on later) and persist BOTH the webhook id (Integration.metadata)
//      and the signing key Quo mints (Credential secret field `webhookSigningSecret`) — merged,
//      never clobbering the stored `apiKey`.
//   2. The capped backfill must sort by `lastActivityAt` DESC. The server orders by `createdAt`
//      DESC, so an old-but-active conversation is exactly what a naive implementation drops.
//   3. The REST mapper must read `text` / `to[]` (the webhook says `body` / `to: string`) and
//      must not ingest a media-only MMS as an empty message.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenPhoneProvider } from '../openphone-provider'

const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set: updateSet })
  return {
    update,
    updateSet,
    updateWhere,
    mergeSecretFields: vi.fn(),
    createMessageWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    sendMessage: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
  }
})

// Partial mock: the chainable proxy still backs every builder the rest of the module graph
// touches at import time (see `src/test/database-mock.ts`), and the schema proxy auto-vivifies
// every table. Only `update` is pinned to a spy so this suite can assert on the jsonb-merge
// writes without the rest of the import graph dying at collection.
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import(
    '../../../test/database-mock'
  )
  const database = new Proxy(createChainableDatabaseMock(), {
    get: (target: any, prop: string) => {
      if (prop === 'update') return mocks.update
      return target[prop]
    },
  })
  return {
    database,
    schema: createSchemaMock({
      Integration: { id: 'Integration.id', metadata: 'Integration.metadata' },
    }),
  }
})

// Partial mock: silence log output without replacing the rest of the barrel.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@auxx/credentials/store', () => ({
  mergeSecretFields: mocks.mergeSecretFields,
  revealSecrets: vi.fn(),
}))

// The Quo client is a thin local wrapper around `fetch`; stubbing it is what keeps this suite
// off the network while still exercising every request shape the provider builds.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  createMessageWebhook: mocks.createMessageWebhook,
  deleteWebhook: mocks.deleteWebhook,
  sendMessage: mocks.sendMessage,
  listConversations: mocks.listConversations,
  listMessages: mocks.listMessages,
}))

const CALLBACK_URL = 'https://app.test/api/openphone/webhook'
const PHONE_NUMBER_ID = 'PN0eLoM7TQ'
const PHONE_NUMBER = '+18889155797'

function makeProvider(metadata: Record<string, unknown> = {}) {
  const provider = new OpenPhoneProvider('org_1')
  const self = provider as any
  self.integrationId = 'int_1'
  self.apiKey = 'quo_key'
  self.credentialId = 'cred_1'
  self.phoneNumberId = PHONE_NUMBER_ID
  self.phoneNumber = PHONE_NUMBER
  self.metadata = { phoneNumberId: PHONE_NUMBER_ID, phoneNumber: PHONE_NUMBER, ...metadata }
  self.storageService = {
    setIntegrationSettings: vi.fn(),
    setBackfillCutoff: vi.fn(),
    batchStoreMessages: vi.fn().mockResolvedValue(0),
  }
  return provider
}

/** Walks a drizzle `sql\`...\`` template's chunks for an interpolated value. */
function sqlContains(sqlChunk: any, value: string): boolean {
  if (!sqlChunk || typeof sqlChunk !== 'object' || !Array.isArray(sqlChunk.queryChunks))
    return false
  return sqlChunk.queryChunks.some((chunk: any) => {
    if (typeof chunk === 'string') return chunk.includes(value)
    if (chunk && typeof chunk === 'object' && Array.isArray(chunk.value)) {
      return chunk.value.some((v: unknown) => typeof v === 'string' && v.includes(value))
    }
    if (chunk && typeof chunk === 'object' && typeof chunk.value === 'string') {
      return chunk.value.includes(value)
    }
    return false
  })
}

function conversation(overrides: Record<string, unknown>) {
  return {
    id: 'CN1',
    phoneNumberId: PHONE_NUMBER_ID,
    participants: ['+13109531695'],
    name: null,
    assignedTo: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lastActivityAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mergeSecretFields.mockResolvedValue({ isErr: () => false })
  mocks.listMessages.mockResolvedValue({ data: [], nextPageToken: null })
})

describe('OpenPhoneProvider.setupWebhook', () => {
  it('creates an enabled webhook and persists id + key', async () => {
    const provider = makeProvider()
    mocks.createMessageWebhook.mockResolvedValue({
      id: 'WH_new',
      key: 'c2lnbmluZy1rZXk=',
      status: 'enabled',
    })

    await provider.setupWebhook(CALLBACK_URL)

    const body = mocks.createMessageWebhook.mock.calls[0]![1]
    expect(body.url).toBe(CALLBACK_URL)
    expect(body.events).toEqual([
      'message.received',
      'message.delivered',
      'call.completed',
      'call.recording.completed',
    ])
    // Per-number, not `["*"]` — one channel owns one webhook.
    expect(body.resourceIds).toEqual([PHONE_NUMBER_ID])
    // Created ENABLED, because Quo webhooks are immutable — `/v1/webhooks/{id}` routes only GET
    // and DELETE, so there is no later call that could flip a `disabled` webhook on. Creating
    // disabled would arm nothing at all.
    expect(body.status).toBe('enabled')

    // The signing key is merged onto the Credential's secret bag, keyed exactly as the webhook
    // route's `resolveWebhookSecret({ kind: 'credentialField', field: 'webhookSigningSecret' })`.
    expect(mocks.mergeSecretFields).toHaveBeenCalledWith('cred_1', 'org_1', {
      webhookSigningSecret: 'c2lnbmluZy1rZXk=',
    })
    // MERGE, not replace: only the one field is written, so the stored apiKey survives.
    const mergedFields = mocks.mergeSecretFields.mock.calls[0]![2]
    expect(Object.keys(mergedFields)).toEqual(['webhookSigningSecret'])
    expect(mergedFields).not.toHaveProperty('apiKey')

    // The webhook id lands on Integration.metadata as a jsonb merge, not a whole-object replace.
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const setArg = mocks.updateSet.mock.calls[0]![0]
    expect(sqlContains(setArg.metadata, 'WH_new')).toBe(true)
    expect(sqlContains(setArg.metadata, 'webhookId')).toBe(true)

    // The key is stored before the id, so the window in which a delivered event cannot be
    // verified is as short as the API allows.
    expect(mocks.mergeSecretFields.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.update.mock.invocationCallOrder[0]!
    )
  })

  it('deletes the stored webhook before re-arming so only one stays live', async () => {
    const provider = makeProvider({ webhookId: 'WH_old' })
    mocks.deleteWebhook.mockResolvedValue(undefined)
    mocks.createMessageWebhook.mockResolvedValue({ id: 'WH_new', key: 'a2V5', status: 'enabled' })

    await provider.setupWebhook(CALLBACK_URL)

    expect(mocks.deleteWebhook).toHaveBeenCalledWith('quo_key', 'WH_old')
    expect(mocks.deleteWebhook.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.createMessageWebhook.mock.invocationCallOrder[0]!
    )
  })

  it('rolls the webhook back when the signing key cannot be stored', async () => {
    const provider = makeProvider()
    mocks.createMessageWebhook.mockResolvedValue({ id: 'WH_orphan', key: 'a2V5' })
    mocks.mergeSecretFields.mockResolvedValue({
      isErr: () => true,
      error: { message: 'credential gone' },
    })

    await expect(provider.setupWebhook(CALLBACK_URL)).rejects.toThrow(/credential gone/)

    // Torn back down — a live webhook whose signature we can never verify is worse than no
    // webhook at all, and Quo offers no way to disable one in place.
    expect(mocks.deleteWebhook).toHaveBeenCalledWith('quo_key', 'WH_orphan')
  })
})

describe('OpenPhoneProvider.syncMessages — capped backfill', () => {
  it('sorts by lastActivityAt DESC (not the server createdAt order) and caps at the limit', async () => {
    const provider = makeProvider({ backfillConversationLimit: 2 })
    // Server order is `createdAt` DESC. `CN_old_active` was created first (so it is LAST in the
    // server's order) but received a message yesterday — the exact row a naive "take the first
    // N pages" implementation drops.
    mocks.listConversations.mockResolvedValue({
      data: [
        conversation({
          id: 'CN_new_quiet',
          createdAt: '2026-08-10T00:00:00.000Z',
          lastActivityAt: '2026-08-10T00:00:00.000Z',
          participants: ['+13100000001'],
        }),
        conversation({
          id: 'CN_mid',
          createdAt: '2026-08-05T00:00:00.000Z',
          lastActivityAt: '2026-08-12T00:00:00.000Z',
          participants: ['+13100000002'],
        }),
        conversation({
          id: 'CN_old_active',
          createdAt: '2025-03-01T00:00:00.000Z',
          lastActivityAt: '2026-08-14T00:00:00.000Z',
          participants: ['+13100000003'],
        }),
      ],
      nextPageToken: null,
    })

    await provider.syncMessages()

    const fetched = mocks.listMessages.mock.calls.map((call) => call[1].participants[0])
    // Top two by lastActivityAt, most recent first. CN_new_quiet is cut by the cap.
    expect(fetched).toEqual(['+13100000003', '+13100000002'])

    // The scope params keep each endpoint's own convention: bracketed E.164 on
    // /v1/conversations, the singular `PN…` id plus bare participants on /v1/messages.
    expect(mocks.listConversations.mock.calls[0]![1].phoneNumber).toBe(PHONE_NUMBER)
    expect(mocks.listMessages.mock.calls[0]![1].phoneNumberId).toBe(PHONE_NUMBER_ID)
  })

  it('stamps initialBackfillCompletedAt on success and lifts the ingest cutoff', async () => {
    const provider = makeProvider({ backfillConversationLimit: 1 })
    mocks.listConversations.mockResolvedValue({ data: [conversation({})], nextPageToken: null })

    await provider.syncMessages()

    const metadataWrites = mocks.updateSet.mock.calls
      .map((call) => call[0].metadata)
      .filter(Boolean)
    expect(metadataWrites.some((m: any) => sqlContains(m, 'initialBackfillCompletedAt'))).toBe(true)
    expect(metadataWrites.some((m: any) => sqlContains(m, 'backfill'))).toBe(true)
    expect((provider as any).storageService.setBackfillCutoff).toHaveBeenCalledWith(null)

    // lastSyncedAt is only stamped on the success path.
    expect(mocks.updateSet.mock.calls.some((call) => call[0].lastSyncedAt instanceof Date)).toBe(
      true
    )
  })

  it('does not stamp lastSyncedAt when the run fails', async () => {
    const provider = makeProvider({ backfillConversationLimit: 1 })
    mocks.listConversations.mockRejectedValue(new Error('Quo API error (500): boom'))

    await expect(provider.syncMessages()).rejects.toThrow('boom')

    expect(mocks.updateSet.mock.calls.some((call) => call[0].lastSyncedAt instanceof Date)).toBe(
      false
    )
  })

  it('terminates paging on nextPageToken alone (totalItems is per-page)', async () => {
    const provider = makeProvider({ backfillConversationLimit: 500 })
    mocks.listConversations
      .mockResolvedValueOnce({
        data: [conversation({ id: 'CN1' })],
        totalItems: 1,
        nextPageToken: 'page2',
      })
      .mockResolvedValueOnce({
        data: [conversation({ id: 'CN2', participants: ['+13100000009'] })],
        totalItems: 1,
        nextPageToken: null,
      })
      .mockResolvedValue({ data: [], nextPageToken: null })

    await provider.syncMessages()

    expect(mocks.listConversations.mock.calls[1]![1].pageToken).toBe('page2')
    expect(mocks.listMessages).toHaveBeenCalledTimes(2)
  })
})

describe('OpenPhoneProvider REST message mapping', () => {
  const conv = conversation({ id: 'CNx', participants: ['+13109531695'] })

  function mapOne(message: Record<string, unknown>) {
    const provider = makeProvider()
    return (provider as any).mapRestMessageToMessageData(message, conv)
  }

  it('reads `text` and the `to` ARRAY (the webhook shape would read undefined)', () => {
    const mapped = mapOne({
      id: 'AC1',
      to: ['+13109531695', '+13109531696'],
      from: PHONE_NUMBER,
      text: 'hello there',
      direction: 'outgoing',
      status: 'delivered',
      createdAt: '2026-08-15T00:12:25.083Z',
      phoneNumberId: PHONE_NUMBER_ID,
      conversationId: 'CNx',
    })

    expect(mapped.textPlain).toBe('hello there')
    expect(mapped.to.map((p: any) => p.identifier)).toEqual(['+13109531695', '+13109531696'])
    expect(mapped.from.identifier).toBe(PHONE_NUMBER)
    expect(mapped.isInbound).toBe(false)
    expect(mapped.externalId).toBe('AC1')
    expect(mapped.externalThreadId).toBe('CNx')
    expect(mapped.subject).toBeUndefined()
    // No attachment ingestor and no media on REST — claiming true fires attachment rules for
    // bytes that were never fetched.
    expect(mapped.hasAttachments).toBe(false)
  })

  it('maps `direction: "incoming"` (not "inbound") to isInbound', () => {
    const mapped = mapOne({
      id: 'AC2',
      to: [PHONE_NUMBER],
      from: '+13109531695',
      text: 'inbound text',
      direction: 'incoming',
      status: 'received',
      createdAt: '2026-08-15T00:12:25.083Z',
      phoneNumberId: PHONE_NUMBER_ID,
      conversationId: 'CNx',
    })

    expect(mapped.isInbound).toBe(true)
    expect(mapped.receivedAt.toISOString()).toBe('2026-08-15T00:12:25.083Z')
  })

  it('placeholders an empty-text message rather than ingesting a blank bubble', () => {
    const mapped = mapOne({
      id: 'AC3',
      to: [PHONE_NUMBER],
      from: '+13109531695',
      text: '',
      direction: 'incoming',
      status: 'received',
      createdAt: '2026-08-15T00:12:25.083Z',
      phoneNumberId: PHONE_NUMBER_ID,
      conversationId: 'CNx',
    })

    expect(mapped.textPlain).toBe('[media — not available via backfill]')
    expect(mapped.snippet).toBe('[media — not available via backfill]')
  })
})

describe('OpenPhoneProvider.sendMessage', () => {
  it('sends `{ content, from, to[] }` and passes multiple recipients through', async () => {
    const provider = makeProvider()
    mocks.sendMessage.mockResolvedValue({ id: 'AC_sent' })

    const result = await provider.sendMessage({
      from: PHONE_NUMBER,
      to: ['+13100000001', '+13100000002'],
      text: 'hi',
    })

    expect(result).toEqual({ id: 'AC_sent', success: true })
    expect(mocks.sendMessage).toHaveBeenCalledWith('quo_key', {
      content: 'hi',
      from: PHONE_NUMBER,
      to: ['+13100000001', '+13100000002'],
    })
  })

  it('truncates explicitly at Quo’s 10-recipient ceiling', async () => {
    const provider = makeProvider()
    mocks.sendMessage.mockResolvedValue({ id: 'AC_sent' })
    const recipients = Array.from({ length: 12 }, (_, i) => `+1310000000${i}`)

    await provider.sendMessage({ from: PHONE_NUMBER, to: recipients, text: 'hi' })

    expect(mocks.sendMessage.mock.calls[0]![1].to).toHaveLength(10)
  })
})

describe('OpenPhoneProvider.getThread', () => {
  it('is a no-op — GET /v1/conversations/{id} does not exist', async () => {
    const provider = makeProvider()
    await expect(provider.getThread('CNx')).resolves.toBeNull()
  })
})
