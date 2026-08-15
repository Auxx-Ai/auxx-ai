// packages/lib/src/channels/__tests__/capabilities.test.ts
//
// `PLATFORM_CAPABILITIES` is THE single declaration site for per-provider
// composer capabilities, so the thing worth testing is coverage, not behavior:
// the Phase-0 bug was a provider missing from a hand-kept list, which nothing
// failed on for months. Every assertion below is driven off
// `IntegrationProviderType` itself, so adding a provider without a capability
// entry (or without a row in the expectation table) turns this file red.

import { IntegrationProviderType } from '@auxx/database/enums'
import type { IntegrationProviderType as IntegrationProviderTypeValue } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { canStartOutbound, getComposerCapabilities, PLATFORM_CAPABILITIES } from '../capabilities'

const ALL_PROVIDERS = Object.values(IntegrationProviderType) as IntegrationProviderTypeValue[]

interface Expectation {
  richText: boolean
  signature: boolean
  maxMessageLength: number | undefined
  /** `canStartOutbound(provider, 'email')` */
  emailScope: boolean
  /** `canStartOutbound(provider, 'addressable')` */
  addressableScope: boolean
}

const email = (over: Partial<Expectation> = {}): Expectation => ({
  richText: true,
  signature: true,
  maxMessageLength: undefined,
  emailScope: true,
  addressableScope: true,
  ...over,
})

const messaging = (over: Partial<Expectation> = {}): Expectation => ({
  richText: false,
  signature: false,
  maxMessageLength: undefined,
  emailScope: false,
  addressableScope: false,
  ...over,
})

const EXPECTED: Record<IntegrationProviderTypeValue, Expectation> = {
  [IntegrationProviderType.google]: email(),
  [IntegrationProviderType.outlook]: email(),
  [IntegrationProviderType.email]: email(),
  [IntegrationProviderType.imap]: email(),
  [IntegrationProviderType.mailgun]: email(),
  // `thread_only` — reply only, inside the 24h customer-service window.
  [IntegrationProviderType.facebook]: messaging(),
  [IntegrationProviderType.instagram]: messaging(),
  [IntegrationProviderType.sms]: messaging({ addressableScope: true }),
  [IntegrationProviderType.openphone]: messaging({
    addressableScope: true,
    maxMessageLength: 1600,
  }),
  [IntegrationProviderType.whatsapp]: messaging({ addressableScope: true }),
  // `newOutbound: true` but addresses a `platform_user`, which the composer has
  // no input for — picking it would render a composer with no way to send.
  [IntegrationProviderType.chat]: messaging(),
  [IntegrationProviderType.shopify]: messaging(),
}

describe('PLATFORM_CAPABILITIES', () => {
  it('covers exactly the IntegrationProviderType enum', () => {
    expect(Object.keys(PLATFORM_CAPABILITIES).sort()).toEqual([...ALL_PROVIDERS].sort())
  })

  it('has an expectation row for every provider', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ALL_PROVIDERS].sort())
  })

  it.each(ALL_PROVIDERS)('%s declares the composer capability fields', (provider) => {
    const caps = getComposerCapabilities(provider)
    expect(caps).toBeDefined()
    if (!caps) return
    const expected = EXPECTED[provider]

    expect(typeof caps.richText).toBe('boolean')
    expect(typeof caps.signature).toBe('boolean')
    expect(caps.richText).toBe(expected.richText)
    expect(caps.signature).toBe(expected.signature)
    expect(caps.maxMessageLength).toBe(expected.maxMessageLength)

    // Rich text and signatures are an email affordance; a messaging channel
    // that claims either would render a toolbar whose output is dropped on
    // send (`textHtml: null`).
    expect(caps.richText).toBe(caps.channel === 'email')
    expect(caps.signature).toBe(caps.channel === 'email')
  })

  it.each(ALL_PROVIDERS)('%s resolves canStartOutbound for both scopes', (provider) => {
    const expected = EXPECTED[provider]
    expect(canStartOutbound(provider, 'email')).toBe(expected.emailScope)
    expect(canStartOutbound(provider, 'addressable')).toBe(expected.addressableScope)
  })

  it('never offers a phone channel to the email scope', () => {
    for (const provider of ALL_PROVIDERS) {
      const caps = getComposerCapabilities(provider)
      if (caps?.recipientModel !== 'phone') continue
      expect(canStartOutbound(provider, 'email')).toBe(false)
      expect(canStartOutbound(provider, 'addressable')).toBe(true)
    }
  })

  it('returns undefined for an unknown provider', () => {
    expect(getComposerCapabilities('not-a-provider')).toBeUndefined()
    expect(canStartOutbound('not-a-provider', 'addressable')).toBe(false)
  })

  it('only caps message length on channels that cannot carry rich text', () => {
    for (const provider of ALL_PROVIDERS) {
      const caps = getComposerCapabilities(provider)
      if (caps?.maxMessageLength === undefined) continue
      expect(caps.maxMessageLength).toBeGreaterThan(0)
      expect(caps.richText).toBe(false)
    }
  })
})
