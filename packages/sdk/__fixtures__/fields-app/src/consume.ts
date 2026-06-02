// packages/sdk/__fixtures__/fields-app/src/consume.ts
//
// Exercises the narrowed value-I/O surface. Valid usage must type-check; each
// invalid usage carries a `@ts-expect-error` — if the narrowing regresses (the
// bad line stops erroring), the unused `@ts-expect-error` itself becomes a
// compile error and the test fails. Positive return-type checks use exact-type
// assignments that would error if the type widened.

import { getFieldValue, getFieldValues, setFieldValues } from '@auxx/sdk/server'

export async function exercise(recordId: string) {
  // Valid: declared keys, correctly typed values (select narrowed to its union).
  await setFieldValues(recordId, { customerId: 'gid://shopify/Customer/1', tier: 'gold' })

  // Valid: bulk form.
  await setFieldValues([{ recordId, values: { customerId: 'gid://shopify/Customer/2' } }])

  // @ts-expect-error — 'bogus' is not a declared appFieldKey
  await setFieldValues(recordId, { bogus: 1 })

  // @ts-expect-error — 'bronze' is not a declared option for the `tier` select
  await setFieldValues(recordId, { tier: 'bronze' })

  // @ts-expect-error — wrong-typed value for a TEXT field
  await setFieldValues(recordId, { customerId: 123 })

  const customerId = await getFieldValue(recordId, 'customerId')
  const assertCustomerId: string | null = customerId

  const tier = await getFieldValue(recordId, 'tier')
  const assertTier: 'gold' | 'silver' | null = tier

  // @ts-expect-error — 'nope' is not a declared appFieldKey
  await getFieldValue(recordId, 'nope')

  const all = await getFieldValues(recordId, ['customerId', 'tier'])

  // @ts-expect-error — 'nope' is not a declared appFieldKey
  await getFieldValues(recordId, ['nope'])

  return { assertCustomerId, assertTier, all }
}
