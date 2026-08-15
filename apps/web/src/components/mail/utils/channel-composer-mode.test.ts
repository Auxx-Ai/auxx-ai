// apps/web/src/components/mail/utils/channel-composer-mode.test.ts

import { IntegrationProviderType } from '@auxx/database/enums'
import { PLATFORM_CAPABILITIES } from '@auxx/lib/channels/client'
import { describe, expect, it } from 'vitest'
import { channelUsesAlwaysOnComposer } from './channel-composer-mode'

/**
 * The bug this guards: the always-on composer was keyed to `provider === 'chat'`,
 * so SMS threads rendered with no reachable composer at all — the affordance was
 * tied to one provider name instead of to the property that motivates it. A
 * table over every provider is what catches the next channel being added without
 * anyone thinking about which flow it belongs in.
 */
describe('channelUsesAlwaysOnComposer', () => {
  it('covers every provider in the capability map', () => {
    expect(new Set(Object.keys(PLATFORM_CAPABILITIES))).toEqual(
      new Set(Object.values(IntegrationProviderType))
    )
  })

  it.each(
    Object.values(IntegrationProviderType)
  )('agrees with PlatformCapabilities.channel for %s', (provider) => {
    const caps = PLATFORM_CAPABILITIES[provider]
    expect(channelUsesAlwaysOnComposer(provider)).toBe(caps.channel !== 'email')
  })

  it('puts email channels on the click-to-reveal flow', () => {
    expect(channelUsesAlwaysOnComposer(IntegrationProviderType.google)).toBe(false)
    expect(channelUsesAlwaysOnComposer(IntegrationProviderType.outlook)).toBe(false)
  })

  it('puts conversational channels on the always-on composer', () => {
    // The regression case: openphone must not depend on being named 'chat'.
    expect(channelUsesAlwaysOnComposer(IntegrationProviderType.openphone)).toBe(true)
    expect(channelUsesAlwaysOnComposer(IntegrationProviderType.chat)).toBe(true)
  })

  it('treats an unknown or absent provider as email', () => {
    // Anything not yet in the capability map keeps today's behaviour rather than
    // acquiring a composer nobody designed for it.
    expect(channelUsesAlwaysOnComposer(undefined)).toBe(false)
    expect(channelUsesAlwaysOnComposer(null)).toBe(false)
    expect(channelUsesAlwaysOnComposer('not_a_provider')).toBe(false)
  })
})
