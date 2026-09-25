// apps/lambda/src/executors/__tests__/data-connector-executor.test.ts

import { assertEquals } from 'jsr:@std/assert'
import { parseError } from '../../utils.ts'
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
    mode: 'snapshot',
    state: { cursor: 'c1' },
    config: { result },
    context: runtimeContext,
    timeout: 5000,
    memoryLimit: 128,
  })
}

Deno.test('passes rateLimited through with the same cursor', async () => {
  const out = await run({
    records: [],
    nextState: { cursor: 'c1' },
    rateLimited: { retryAfterMs: 2000 },
  })
  assertEquals(out.result, {
    records: [],
    nextState: { cursor: 'c1' },
    rateLimited: { retryAfterMs: 2000 },
  })
})

Deno.test('omits rateLimited when the app does not set it', async () => {
  const out = await run({ records: [{ id: 'a' }], nextState: { cursor: 'c2' } })
  assertEquals(out.result, { records: [{ id: 'a' }], nextState: { cursor: 'c2' } })
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
    const out = await run({ records: [], nextState: { cursor: 'c1' }, rateLimited })
    assertEquals((out.result as { rateLimited?: unknown }).rateLimited, {}, String(rateLimited))
  }
})

Deno.test('rateLimited survives the MAX_RECORDS_PER_FETCH truncation path', async () => {
  const records = Array.from({ length: 5001 }, (_, i) => ({ id: i }))
  const out = await run({ records, nextState: { cursor: 'c1' }, rateLimited: { retryAfterMs: 1 } })
  const result = out.result as { records: unknown[]; rateLimited?: unknown }
  assertEquals(result.records.length, 5000)
  assertEquals(result.rateLimited, { retryAfterMs: 1 })
})

/** Echoes the args it got; throws a UnpushableFilterError-shaped error on an exact `nope` clause. */
const FILTER_BUNDLE = `
  class UnpushableFilterError extends Error {
    constructor(streamKey, clause) {
      super('Stream "' + streamKey + '" cannot narrow on ' + clause.fieldId)
      this.name = 'UnpushableFilterError'
      this.code = 'UNPUSHABLE_FILTER'
    }
  }
  const __AUXX_DATA_CONNECTORS__ = {
    demo: {
      execute: async ({ streamKey, recordFilter, config }) => {
        const bad = (recordFilter ?? []).find((c) => c.exact && c.fieldId === 'nope')
        if (bad) throw new UnpushableFilterError(streamKey, bad)
        return { records: [{ recordFilter }], nextState: {}, narrowed: config.narrowed }
      },
    },
  };
`

function runFiltered(recordFilter: unknown, narrowed: unknown = true) {
  return executeDataConnector({
    type: 'data-connector',
    bundleCode: FILTER_BUNDLE,
    connectorId: 'demo',
    streamKey: 'order',
    mode: 'snapshot',
    state: {},
    config: { narrowed },
    recordFilter: recordFilter as never,
    context: runtimeContext,
    timeout: 5000,
    memoryLimit: 128,
  })
}

const PERIOD = {
  fieldId: 'created_at',
  operator: 'between',
  value: { from: '2026-08-01T00:00:00Z' },
  exact: true,
}

Deno.test('passes recordFilter through to execute and narrowed back', async () => {
  const out = await runFiltered([PERIOD])
  assertEquals(out.result, {
    records: [{ recordFilter: [PERIOD] }],
    nextState: {},
    narrowed: true,
  })
})

Deno.test('drops a narrowed value that is not literally true', async () => {
  for (const narrowed of [null, false, 'yes', 1]) {
    const out = await runFiltered([PERIOD], narrowed)
    assertEquals('narrowed' in (out.result as object), false, String(narrowed))
  }
})

Deno.test('an UnpushableFilterError keeps its code and message across the boundary', async () => {
  const clause = { fieldId: 'nope', operator: 'is', value: 'x', exact: true }
  let caught: unknown
  try {
    await runFiltered([clause])
  } catch (error) {
    caught = error
  }
  const parsed = parseError(caught)
  assertEquals(parsed.code, 'UNPUSHABLE_FILTER')
  assertEquals(parsed.message, 'Stream "order" cannot narrow on nope')
})
