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
  mode: 'snapshot',
  state: {},
  config: {},
}

Deno.test('accepts a data-connector event without recordFilter', () => {
  assertEquals(validateLambdaEvent(EVENT).success, true)
})

Deno.test('accepts and keeps a well-formed recordFilter', () => {
  const recordFilter = [
    { fieldId: 'created_at', operator: 'between', value: { from: '2026-08-01' }, exact: true },
    { fieldId: 'orders_count', operator: '>', value: 0 },
    { fieldId: 'email', operator: 'is_not_empty' },
  ]
  const result = validateLambdaEvent({ ...EVENT, recordFilter })
  if (!result.success || !('data' in result)) throw new Error('expected a valid event')
  assertEquals((result.data as { recordFilter?: unknown }).recordFilter, recordFilter)
})

Deno.test('rejects a malformed recordFilter clause', () => {
  const bad: unknown[] = [
    'created_at',
    [{ operator: '>' }],
    [{ fieldId: '', operator: '>' }],
    [{ fieldId: 'x', operator: 1 }],
    [{ fieldId: 'x', operator: '>', exact: 'yes' }],
  ]
  for (const recordFilter of bad) {
    assertEquals(
      validateLambdaEvent({ ...EVENT, recordFilter }).success,
      false,
      JSON.stringify(recordFilter)
    )
  }
})
