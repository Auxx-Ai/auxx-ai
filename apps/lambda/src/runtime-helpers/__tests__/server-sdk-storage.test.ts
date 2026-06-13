// apps/lambda/src/runtime-helpers/__tests__/server-sdk-storage.test.ts

/**
 * Tests for the app KV storage host wired into the server SDK.
 *
 * `@auxx/sdk/server` is externalized to the `AUXX_SERVER_SDK` global at app
 * build time, so the SDK wrapper is never bundled — the sandbox calls
 * `AUXX_SERVER_SDK.storage` directly with the public POSITIONAL surface
 * (`get(key, opts)`, `set(key, value, opts)`, `collection(name).set(...)`).
 * These tests exercise the host through that surface (the contract production
 * relies on) with a stubbed `context.fetch`, including the regression guard
 * that positional args reach the URL/body instead of becoming `undefined`.
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
    () => sdk.storage.get('k', { scope: 'connection' }),
    Error,
    'requires a connection'
  )
})

Deno.test('connection scope sends X-App-Connection-Id and the key reaches the URL', async () => {
  const { context, calls } = makeContext(
    { data: { item: { value: { token: 'abc' } } } },
    { userConnection: { id: 'conn_1', type: 'secret', value: 'x' } }
  )
  const sdk = createServerSDK(context)
  const item = await sdk.storage.get('bearer', { scope: 'connection' })

  assertEquals(item, { value: { token: 'abc' } })
  assertEquals(calls[0].url, 'https://api.test/api/v1/sdk/storage/item/bearer?collection=')
  assertEquals(calls[0].headers['X-App-Connection-Id'], 'conn_1')
  assertEquals(calls[0].headers['X-App-Installation-Id'], 'inst')
})

Deno.test('installation scope omits the connection header and defaults collection to ""', async () => {
  const { context, calls } = makeContext({ data: { item: null } })
  const sdk = createServerSDK(context)
  await sdk.storage.get('k')
  assertEquals(calls[0].url, 'https://api.test/api/v1/sdk/storage/item/k?collection=')
  assertEquals(calls[0].headers['X-App-Connection-Id'], undefined)
})

Deno.test('regression: positional set reaches the URL/body (not item/undefined)', async () => {
  const { context, calls } = makeContext(
    { data: { success: true } },
    { userConnection: { id: 'conn_1', type: 'secret', value: 'x' } }
  )
  const sdk = createServerSDK(context)
  // The exact FedEx token-cache call that produced `item/undefined?collection=undefined`.
  await sdk.storage.set('bearer-token', { token: 'abc' }, { scope: 'connection', ttlSeconds: 3300 })
  assertEquals(calls[0].method, 'PUT')
  assertEquals(calls[0].url, 'https://api.test/api/v1/sdk/storage/item/bearer-token')
  assertEquals(calls[0].body, {
    value: { token: 'abc' },
    collection: '',
    ttlSeconds: 3300,
  })
})

Deno.test('collection().set passes collection + ttl in the body', async () => {
  const { context, calls } = makeContext({ data: { success: true } })
  const sdk = createServerSDK(context)
  await sdk.storage
    .collection('watch', { scope: 'installation' })
    .set('1Z', { status: 'in_transit' }, { ttlSeconds: 100 })
  assertEquals(calls[0].method, 'PUT')
  assertEquals(calls[0].url, 'https://api.test/api/v1/sdk/storage/item/1Z')
  assertEquals(calls[0].body, {
    value: { status: 'in_transit' },
    collection: 'watch',
    ttlSeconds: 100,
  })
})

Deno.test('collection().setIfAbsent returns data.created and sets ifAbsent in the body', async () => {
  const { context, calls } = makeContext({ data: { created: false } })
  const sdk = createServerSDK(context)
  const created = await sdk.storage.collection('webhook-events').setIfAbsent('evt_1', {})
  assertEquals(created, false)
  assertEquals((calls[0].body as { ifAbsent: boolean }).ifAbsent, true)
})

Deno.test('collection().list unwraps data.entries and encodes the collection + bound scope', async () => {
  const { context, calls } = makeContext(
    { data: { entries: [{ key: 'a', value: 1 }] } },
    { userConnection: { id: 'conn_1', type: 'secret', value: 'x' } }
  )
  const sdk = createServerSDK(context)
  const out = await sdk.storage.collection('watch', { scope: 'connection' }).list({ limit: 5 })
  assertEquals(out, { entries: [{ key: 'a', value: 1 }] })
  assertEquals(calls[0].url, 'https://api.test/api/v1/sdk/storage/list?collection=watch&limit=5')
  assertEquals(calls[0].headers['X-App-Connection-Id'], 'conn_1')
})
