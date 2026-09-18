// apps/lambda/src/runtime-helpers/__tests__/server-sdk-records.test.ts

/**
 * Tests for `getRecord`/`getRecords` on the server SDK
 * (plans/apps/outbound/01-records-api.md §3/§4). Both are thin wrappers over
 * the batch POST route (`/api/v1/organizations/:handle/records/read`) with a
 * stubbed `context.fetch` — these assert the request shape and the
 * single-vs-batch unwrapping, not the route itself (covered separately in
 * `apps/api/src/routes/__tests__/records.test.ts`).
 */

import { assertEquals } from 'jsr:@std/assert'
import type { RuntimeContext } from '../../types.ts'
import { createServerSDK } from '../server-sdk.ts'

interface CapturedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

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
    organization: { id: 'org_1', handle: 'acme' },
    user: { id: 'u', email: 'e@x.com', name: 'n' },
    app: { id: 'app', installationId: 'inst_1' },
    fetch: fetchStub,
    env: 'test',
    apiUrl: 'https://api.test',
    callbackTokens: { webhooks: 'w', settings: 's', storage: 'st', entities: 'ent' },
    ...over,
  }
  return { context, calls }
}

const SAMPLE_NODE = {
  recordId: 'contact:c1',
  entityDefinitionId: 'contact',
  displayName: 'Ann',
  values: {},
  included: {},
  redacted: [],
}

Deno.test('getRecord posts to the org-handle records/read route with the entities token', async () => {
  const { context, calls } = makeContext({ 'contact:c1': SAMPLE_NODE })
  const sdk = createServerSDK(context)

  const record = await sdk.getRecord('contact:c1', { fields: ['title'] })

  assertEquals(calls.length, 1)
  assertEquals(calls[0]!.url, 'https://api.test/api/v1/organizations/acme/records/read')
  assertEquals(calls[0]!.headers.Authorization, 'Bearer ent')
  assertEquals(calls[0]!.headers['X-App-Installation-Id'], 'inst_1')
  // `JSON.stringify` drops `undefined`-valued keys — `include` is absent
  // from the wire body, not present-and-undefined.
  assertEquals(calls[0]!.body, { recordIds: ['contact:c1'], fields: ['title'] })
  assertEquals(record, SAMPLE_NODE)
})

Deno.test('getRecord returns null when the recordId is absent from the response map', async () => {
  const { context } = makeContext({})
  const sdk = createServerSDK(context)

  const record = await sdk.getRecord('contact:hidden')

  assertEquals(record, null)
})

Deno.test('getRecords forwards the full id list and returns the map as-is', async () => {
  const responseBody = { 'contact:c1': SAMPLE_NODE }
  const { context, calls } = makeContext(responseBody)
  const sdk = createServerSDK(context)

  const records = await sdk.getRecords(['contact:c1', 'contact:c2'], {
    include: { company: {} },
  })

  assertEquals(calls[0]!.body, {
    recordIds: ['contact:c1', 'contact:c2'],
    include: { company: {} },
  })
  // contact:c2 is absent from the handler's result (hidden or missing) —
  // absent from the map here too, never a null placeholder entry.
  assertEquals(records, responseBody)
})
