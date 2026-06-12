// apps/lambda/src/runtime-helpers/__tests__/server-sdk-storage.test.ts

/**
 * Tests for the app KV storage host wired into the server SDK: scope
 * resolution (connection vs installation), the no-connection throw, collection
 * passthrough, and the `{ value }` unwrapping. The host is exercised through
 * `createServerSDK(context).storage` with a stubbed `context.fetch`.
 */

import { assertEquals, assertRejects } from 'jsr:@std/assert'
import type { RuntimeContext } from '../../types.ts'
import { createServerSDK } from '../server-sdk.ts'

interface CapturedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** Build a context whose `fetch` records calls and returns a canned JSON body. */
function makeContext(
  responseBody: unknown,
  over: Partial<RuntimeContext> = {}
): { context: RuntimeContext; calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body ? JSON.parse(init.body as string) : undefined,
    })
    return new Response(JSON.stringify(responseBody), { status: 200 })
  }) as unknown as typeof fetch

  const context: RuntimeContext = {
    organization: { id: 'org', handle: 'h' },
    user: { id: 'u', email: 'e@x.com', name: 'n' },
    app: { id: 'app', installationId: 'inst' },
    fetch: fetchStub,
    env: 'test',
    apiUrl: 'https://api.test',
    callbackTokens: { webhooks: 'w', settings: 's', storage: 'st' },
    ...over,
  }
  return { context, calls }
}

Deno.test('connection scope throws when no connection is in context', async () => {
  const { context } = makeContext({ data: { item: null } })
  const sdk = createServerSDK(context)
  await assertRejects(
    () => sdk.storage.get({ collection: '', key: 'k', scope: 'connection' }),
    Error,
    'requires a connection'
  )
})

Deno.test('connection scope sends X-App-Connection-Id from the bound connection', async () => {
  const { context, calls } = makeContext(
    { data: { item: { value: { token: 'abc' } } } },
    { userConnection: { id: 'conn_1', type: 'secret', value: 'x' } }
  )
  const sdk = createServerSDK(context)
  const item = await sdk.storage.get({ collection: '', key: 'bearer', scope: 'connection' })

  assertEquals(item, { value: { token: 'abc' } })
  assertEquals(calls[0].headers['X-App-Connection-Id'], 'conn_1')
  assertEquals(calls[0].headers['X-App-Installation-Id'], 'inst')
})

Deno.test('installation scope omits the connection header', async () => {
  const { context, calls } = makeContext({ data: { item: null } })
  const sdk = createServerSDK(context)
  await sdk.storage.get({ collection: '', key: 'k', scope: 'installation' })
  assertEquals(calls[0].headers['X-App-Connection-Id'], undefined)
})

Deno.test('set passes collection + ttl in the body', async () => {
  const { context, calls } = makeContext({ data: { success: true } })
  const sdk = createServerSDK(context)
  await sdk.storage.set({
    collection: 'watch',
    key: '1Z',
    value: { status: 'in_transit' },
    scope: 'installation',
    ttlSeconds: 100,
  })
  assertEquals(calls[0].method, 'PUT')
  assertEquals(calls[0].body, {
    value: { status: 'in_transit' },
    collection: 'watch',
    ttlSeconds: 100,
  })
})

Deno.test('setIfAbsent returns data.created and sets ifAbsent in the body', async () => {
  const { context, calls } = makeContext({ data: { created: false } })
  const sdk = createServerSDK(context)
  const created = await sdk.storage.setIfAbsent({
    collection: 'webhook-events',
    key: 'evt_1',
    value: {},
    scope: 'installation',
  })
  assertEquals(created, false)
  assertEquals((calls[0].body as { ifAbsent: boolean }).ifAbsent, true)
})

Deno.test('list unwraps data.entries and encodes the collection in the query', async () => {
  const { context, calls } = makeContext({ data: { entries: [{ key: 'a', value: 1 }] } })
  const sdk = createServerSDK(context)
  const out = await sdk.storage.list({ collection: 'watch', scope: 'installation', limit: 5 })
  assertEquals(out, { entries: [{ key: 'a', value: 1 }] })
  assertEquals(calls[0].url, 'https://api.test/api/v1/sdk/storage/list?collection=watch&limit=5')
})
