// apps/lambda/src/__tests__/validator.test.ts

import { assertEquals } from 'jsr:@std/assert'
import { validateLambdaEvent } from '../validator.ts'

const EVENT = {
  type: 'data-connector',
  serverBundleSha: 'sha1',
  context: {
    organizationId: 'org1',
    organizationHandle: 'acme',
    appId: 'app1',
    apiUrl: 'https://api.example.com',
    appInstallationId: 'inst1',
  },
  connectorId: 'shopify.core',
  streamKey: 'order',
  query: {},
  config: {},
}

Deno.test('accepts a data-connector event with an empty query', () => {
  assertEquals(validateLambdaEvent(EVENT).success, true)
})

Deno.test('accepts and keeps a full query and cursor', () => {
  const query = {
    ids: ['1', '2'],
    idKind: 'inventoryItem',
    period: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    since: { historyId: '84422' },
  }
  const result = validateLambdaEvent({ ...EVENT, query, cursor: { after: 'x' } })
  if (!result.success || !('data' in result)) throw new Error('expected a valid event')
  const data = result.data as { query?: unknown; cursor?: unknown }
  assertEquals(data.query, query)
  assertEquals(data.cursor, { after: 'x' })
})

Deno.test('rejects a missing or malformed query', () => {
  const { query: _omit, ...withoutQuery } = EVENT
  assertEquals(validateLambdaEvent(withoutQuery).success, false)
  const bad: unknown[] = [
    'created_at',
    { ids: 'a' },
    { ids: [''] },
    { idKind: '' },
    { period: '2026-08-01' },
    { period: { from: 1 } },
  ]
  for (const query of bad) {
    assertEquals(validateLambdaEvent({ ...EVENT, query }).success, false, JSON.stringify(query))
  }
})
