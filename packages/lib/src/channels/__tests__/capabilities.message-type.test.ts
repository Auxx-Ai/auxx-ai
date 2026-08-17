// packages/lib/src/channels/__tests__/capabilities.message-type.test.ts
//
// `PlatformCapabilities.messageType` restates an answer the server already owns:
// `Message.messageType` is not a stored column, it is derived on every read by
// `getMessageTypeFromProvider` (`providers/type-utils.ts`, called from
// `messages/message-query.service.ts`). The restatement exists because
// `providers/` has no client-safe subpath and the composer needs the same value
// to stamp an optimistic row with — but two per-provider maps is exactly the
// drift that kept `openphone` out of the From picker for months.
//
// So they are pinned together here. A provider added to one map and not the
// other, or given a different type in each, is a failing test rather than a
// just-sent SMS that renders as an email card until the realtime echo lands.

import { IntegrationProviderTypeValues } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { getMessageTypeFromProvider } from '../../providers/type-utils'
import type { ChannelProviderType } from '../../providers/types'
import { PLATFORM_CAPABILITIES } from '../capabilities'

describe('PlatformCapabilities.messageType', () => {
  it('agrees with getMessageTypeFromProvider for every provider', () => {
    for (const provider of IntegrationProviderTypeValues) {
      expect(PLATFORM_CAPABILITIES[provider].messageType).toBe(
        getMessageTypeFromProvider(provider as ChannelProviderType)
      )
    }
  })

  it('declares a messageType for every provider — no gaps', () => {
    for (const provider of IntegrationProviderTypeValues) {
      expect(PLATFORM_CAPABILITIES[provider].messageType).toBeTruthy()
    }
  })
})
