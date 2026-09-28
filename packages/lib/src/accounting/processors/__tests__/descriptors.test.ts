// packages/lib/src/accounting/processors/__tests__/descriptors.test.ts
//
// The processor folders against the vocabularies they must agree with (brief 113 D1, §4).

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sourceAccountLabel } from '../../ledger/chart/source-account-label'
import {
  type EntryReferenceResolver,
  getEntryReferenceResolver,
} from '../../money/payouts/reference-resolvers'
import type { PayoutSource } from '../../money/payouts/source'
import {
  __resetPayoutSourcesForTests,
  listPayoutSourceIds,
} from '../../money/payouts/source-registry'
import {
  PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS,
  PAYMENT_GATEWAY_SETTLEMENT_SOURCES,
} from '../../rails/client'
import { MANUAL_RAIL_HANDLES, suggestRail } from '../../rails/rail-catalogue'
import { PROCESSORS } from '../client'
import {
  PROCESSOR_ENTRY_REFERENCE_RESOLVERS,
  PROCESSOR_PAYOUT_SOURCES,
  registerProcessors,
} from '../register'
import type { ProcessorDescriptor } from '../types'

const ROOT = path.resolve(__dirname, '..')
const FOLDERS = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
  .map((entry) => entry.name)

function descriptorIn(module: Record<string, unknown>): ProcessorDescriptor {
  const found = Object.values(module).filter(
    (value): value is ProcessorDescriptor =>
      typeof value === 'object' && value !== null && 'feedApp' in value && 'handles' in value
  )
  expect(found).toHaveLength(1)
  return found[0]!
}

afterEach(() => __resetPayoutSourcesForTests())

describe('processor descriptors', () => {
  it('has one descriptor per non-manual settlement source', () => {
    const ids = PROCESSORS.map((processor) => processor.id).sort()
    const sources = PAYMENT_GATEWAY_SETTLEMENT_SOURCES.filter((source) => source !== 'manual')
    expect(ids).toEqual([...sources].sort())
  })

  it('labels each processor as the settlement-source vocabulary does', () => {
    for (const processor of PROCESSORS) {
      expect(processor.label).toBe(PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS[processor.id])
    }
  })

  it('never lets two descriptors, or a descriptor and a catalogue row, claim one handle', () => {
    const handles = [
      ...PROCESSORS.flatMap((processor) => processor.handles),
      ...MANUAL_RAIL_HANDLES,
    ]
    expect(new Set(handles).size).toBe(handles.length)
  })

  it('stores handles normalised, so the catalogue can find them', () => {
    for (const handle of PROCESSORS.flatMap((processor) => processor.handles)) {
      expect(handle).toBe(handle.trim().toLowerCase())
    }
  })

  it('has a client.ts descriptor in every folder, and a folder for every descriptor', async () => {
    const found: ProcessorDescriptor[] = []
    for (const folder of FOLDERS) {
      found.push(descriptorIn(await import(path.join(ROOT, folder, 'client.ts'))))
    }
    expect(found.map((d) => d.id).sort()).toEqual(PROCESSORS.map((d) => d.id).sort())
  })

  it('registers every folder that has a source.ts or a resolver.ts', async () => {
    registerProcessors()
    for (const folder of FOLDERS) {
      const descriptor = descriptorIn(await import(path.join(ROOT, folder, 'client.ts')))

      if (fs.existsSync(path.join(ROOT, folder, 'source.ts'))) {
        const module = await import(path.join(ROOT, folder, 'source.ts'))
        const source = Object.values(module).find(
          (value) => typeof value === 'object' && value !== null && 'listPayouts' in value
        ) as PayoutSource
        expect(source.id).toBe(descriptor.id)
        expect(PROCESSOR_PAYOUT_SOURCES).toContain(source)
        expect(listPayoutSourceIds()).toContain(descriptor.id)
      }

      if (fs.existsSync(path.join(ROOT, folder, 'resolver.ts'))) {
        const module = await import(path.join(ROOT, folder, 'resolver.ts'))
        const resolver = Object.values(module).find(
          (value) => typeof value === 'object' && value !== null && 'resolve' in value
        ) as EntryReferenceResolver
        expect(resolver.providerKey).toBe(descriptor.id)
        expect(PROCESSOR_ENTRY_REFERENCE_RESOLVERS).toContain(resolver)
        expect(getEntryReferenceResolver(descriptor.id)).toBe(resolver)
      }
    }
  })

  // `sourceAccountLabel` keeps its own check for the `shopify` store key; no processor
  // feed uses its external id as a name yet, and the descriptors must say so.
  it('agrees with sourceAccountLabel on whether an external id is a name', () => {
    for (const processor of PROCESSORS) {
      const label = sourceAccountLabel({ providerKey: processor.id, externalAccountId: 'acme' })
      expect(label === 'acme').toBe(processor.accountLabel === 'external_id')
    }
  })
})

// The catalogue's readable rows are built from the descriptors; these are the rows it
// held as literals before that, and every handle must still suggest exactly this.
describe('suggestRail over the descriptor rows', () => {
  const EXPECTED: Record<string, [string, string, string]> = {
    stripe: ['Stripe', 'stripe', 'netted'],
    shopify_payments: ['Shopify Payments', 'shopify_payments', 'netted'],
    shop_pay_installments: ['Shopify Payments', 'shopify_payments', 'netted'],
    shop_cash: ['Shopify Payments', 'shopify_payments', 'netted'],
    authorize_net: ['Authorize.Net', 'authorize_net', 'billed'],
    'authorize.net': ['Authorize.Net', 'authorize_net', 'billed'],
    authorizenet: ['Authorize.Net', 'authorize_net', 'billed'],
    affirm: ['Affirm', 'affirm', 'netted'],
    afterpay: ['Afterpay', 'manual', 'netted'],
    klarna: ['Klarna', 'manual', 'netted'],
    paypal: ['PayPal', 'manual', 'netted'],
    braintree: ['Braintree', 'manual', 'netted'],
    amazon_pay: ['Amazon Pay', 'manual', 'netted'],
    square: ['Square', 'manual', 'netted'],
  }

  it('suggests the same rail for every known handle', () => {
    for (const [handle, [name, settlementSource, feeTreatment]] of Object.entries(EXPECTED)) {
      expect(suggestRail(handle)).toEqual({
        name,
        settlementSource,
        feeTreatment,
        clearingAccountName: `${name} Clearing`,
        feeAccountName: `${name} Fees`,
        known: true,
      })
    }
  })

  it('knows no handle beyond those', () => {
    const known = [...PROCESSORS.flatMap((processor) => processor.handles), ...MANUAL_RAIL_HANDLES]
    expect(known.sort()).toEqual(Object.keys(EXPECTED).sort())
  })
})
