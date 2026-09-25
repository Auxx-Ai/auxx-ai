// apps/lambda/src/executors/__tests__/data-connector-executor.test.ts

import { assertEquals } from 'jsr:@std/assert'
import { executeDataConnector, sanitizeRateLimited } from '../data-connector-executor.ts'

/** A fake server bundle whose connector returns whatever `config.result` holds. */
const FAKE_BUNDLE = `
  const __AUXX_DATA_CONNECTORS__ = {
    demo: { execute: async ({ config }) => config.result },
  };
`

const runtimeContext = {
  organizationId: 'org1',
  organizationHandle: 'acme',
  app: { installationId: 'inst1' },
}

function run(result: unknown) {
  return executeDataConnector({
    type: 'data-connector',
    bundleCode: FAKE_BUNDLE,
    connectorId: 'demo',
    streamKey: 'order',
    query: {},
    cursor: 'c1',
    config: { result },
    context: runtimeContext,
    timeout: 5000,
    memoryLimit: 128,
  })
}

Deno.test('passes rateLimited through with the same cursor', async () => {
  const out = await run({ records: [], cursor: 'c1', rateLimited: { retryAfterMs: 2000 } })
  assertEquals(out.result, { records: [], cursor: 'c1', rateLimited: { retryAfterMs: 2000 } })
})

Deno.test('omits rateLimited when the app does not set it', async () => {
  const out = await run({ records: [{ id: 'a' }], cursor: 'c2' })
  assertEquals(out.result, { records: [{ id: 'a' }], cursor: 'c2' })
})

Deno.test('returns since on the last page and no cursor', async () => {
  const out = await run({ records: [], since: { historyId: '84422' } })
  assertEquals(out.result, { records: [], since: { historyId: '84422' } })
})

Deno.test('null and false mean no throttle', () => {
  assertEquals(sanitizeRateLimited(null), undefined)
  assertEquals(sanitizeRateLimited(false), undefined)
})

Deno.test('sanitises a malformed rateLimited to a bare throttle signal', async () => {
  const cases: unknown[] = [
    true,
    'soon',
    {},
    { retryAfterMs: 'abc' },
    { retryAfterMs: -5 },
    { retryAfterMs: null },
    { retryAfterMs: Number.POSITIVE_INFINITY },
    { retryAfterMs: Number.NaN },
  ]
  for (const rateLimited of cases) {
    const out = await run({ records: [], cursor: 'c1', rateLimited })
    assertEquals((out.result as { rateLimited?: unknown }).rateLimited, {}, String(rateLimited))
  }
})

Deno.test('rateLimited survives the MAX_RECORDS_PER_FETCH truncation path', async () => {
  const records = Array.from({ length: 5001 }, (_, i) => ({ id: i }))
  const out = await run({ records, cursor: 'c1', rateLimited: { retryAfterMs: 1 } })
  const result = out.result as { records: unknown[]; rateLimited?: unknown }
  assertEquals(result.records.length, 5000)
  assertEquals(result.rateLimited, { retryAfterMs: 1 })
})

/** Echoes the query and cursor it got; throws a DeltaExpiredError-shaped error on a stale `since`. */
const QUERY_BUNDLE = `
  class DeltaExpiredError extends Error {
    constructor(streamKey) {
      super('Stream "' + streamKey + '" delta marker expired')
      this.name = 'DeltaExpiredError'
      this.code = 'DELTA_EXPIRED'
    }
  }
  const __AUXX_DATA_CONNECTORS__ = {
    demo: {
      execute: async ({ streamKey, query, cursor }) => {
        if (query.since === 'stale') throw new DeltaExpiredError(streamKey)
        if (query.since === 'boom') throw new Error('upstream exploded')
        return { records: [{ query, cursor }] }
      },
    },
  };
`

function runQuery(query: Record<string, unknown>, cursor?: unknown) {
  return executeDataConnector({
    type: 'data-connector',
    bundleCode: QUERY_BUNDLE,
    connectorId: 'demo',
    streamKey: 'order',
    query,
    cursor,
    config: {},
    context: runtimeContext,
    timeout: 5000,
    memoryLimit: 128,
  })
}

Deno.test('passes the query and cursor through to execute', async () => {
  const query = { period: { from: '2026-08-01T00:00:00.000Z' }, since: '2026-09-01' }
  const out = await runQuery(query, { after: 'x' })
  assertEquals(out.result, { records: [{ query, cursor: { after: 'x' } }] })
})

Deno.test('a thrown DeltaExpiredError crosses back as deltaExpired data', async () => {
  const out = await runQuery({ since: 'stale' })
  assertEquals(out.result, { records: [], deltaExpired: true })
})

Deno.test('any other error still throws', async () => {
  let caught: unknown
  try {
    await runQuery({ since: 'boom' })
  } catch (error) {
    caught = error
  }
  assertEquals((caught as Error).message, 'upstream exploded')
})
