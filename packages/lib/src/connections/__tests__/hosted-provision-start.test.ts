// packages/lib/src/connections/__tests__/hosted-provision-start.test.ts
//
// The `start()` union and the declared capabilities (decision **B13**, HANDOFF slot 3A
// item 1).
//
// 🛑 The acceptance test B13 sets is that a second provider of the same shape needs
// ZERO code changes - only a definition. These are mostly TYPE assertions, and that is
// deliberate: the failure this guards against is a handler or a caller quietly going
// back to `{ redirectUrl }`, or a route reading a capability off a provider name
// instead of off the definition, and both of those are compile-time facts rather than
// runtime ones.

import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  HostedProvisionCompleteCtx,
  HostedProvisionHandler,
  HostedProvisionStartResult,
} from '../hosted-provision/types'
import { PLATFORM_PROVIDER_DEFS } from '../providers/defs'
import { getProviderByKey } from '../providers/provider-registry'

describe('the start() union', () => {
  it('is a DISCRIMINATED union, so a caller must branch on `kind`', () => {
    // Not two optional keys. A caller that read `url` off an embed result would get
    // `undefined` and navigate to the current page, which looks like "nothing happened".
    const redirect: HostedProvisionStartResult = { kind: 'redirect', url: 'https://example.test' }
    const embed: HostedProvisionStartResult = { kind: 'embed', config: { clientSecret: 'x' } }

    expect(redirect.kind).toBe('redirect')
    expect(embed.kind).toBe('embed')

    if (redirect.kind === 'redirect') expectTypeOf(redirect.url).toEqualTypeOf<string>()
    if (embed.kind === 'embed') {
      expectTypeOf(embed.config).toEqualTypeOf<Record<string, unknown>>()
    }
  })

  it('carries an OPAQUE embed config', () => {
    // The connect surface hands `config` to whatever renders an embed and never reads a
    // provider-specific key out of it. A typed-per-provider config here would be the
    // provider branch B13 forbids, wearing a type.
    expectTypeOf<Extract<HostedProvisionStartResult, { kind: 'embed' }>['config']>().toEqualTypeOf<
      Record<string, unknown>
    >()
  })

  it('lets complete() answer one result or many', () => {
    // 🛑 An array is one flow that yielded SEVERAL provider accounts. The alternative  -
    // the return route enumerating accounts out of the payload so it could call
    // `complete()` once each - would put provider knowledge in the route.
    type Complete = Awaited<ReturnType<HostedProvisionHandler['complete']>>
    expectTypeOf<Complete>().toMatchTypeOf<{ providerAccountId: string } | unknown[]>()
  })

  it('gives complete() an OPTIONAL payload', () => {
    // Optional because the redirect leg returns through a GET carrying nothing but the
    // state token - a redirect handler must not be able to require it.
    expectTypeOf<HostedProvisionCompleteCtx['payload']>().toEqualTypeOf<
      Record<string, unknown> | undefined
    >()
  })
})

describe('declared capabilities', () => {
  it('the bank feed declares multiAccount and embed', () => {
    const provider = getProviderByKey('stripeFinancialConnections')
    expect(provider?.connectionType).toBe('hosted-provision')
    // Both are read GENERICALLY - the return route dedupes on `providerAccountId`
    // because of the first, and the connect surface fetches rather than navigates
    // because of the second. Neither reads the provider key.
    expect(provider?.capabilities).toEqual({ multiAccount: true, embed: true })
  })

  it('Stripe Connect declares neither, and that is what keeps it on the old path', () => {
    // 🛑 The regression this guards: `stripeConnect` is one payments account per org and
    // its return leg must keep reusing the single existing credential. Declaring
    // `multiAccount` on it would let a second onboarding attempt create a second
    // connection instead of updating in place.
    const provider = getProviderByKey('stripeConnect')
    expect(provider?.connectionType).toBe('hosted-provision')
    expect(provider?.capabilities?.multiAccount).toBeUndefined()
    expect(provider?.capabilities?.embed).toBeUndefined()
  })

  it('every hosted-provision definition names a handler key', () => {
    // A definition with `connectionType: 'hosted-provision'` and no
    // `hostedProvisionKey` resolves to a 404 at connect time and to nothing at all in
    // the catalog - a connect button that fails only when pressed.
    for (const def of PLATFORM_PROVIDER_DEFS) {
      if (def.connectionType !== 'hosted-provision') continue
      expect(def.hostedProvisionKey, `${def.providerKey} has no hostedProvisionKey`).toBeTruthy()
    }
  })
})
