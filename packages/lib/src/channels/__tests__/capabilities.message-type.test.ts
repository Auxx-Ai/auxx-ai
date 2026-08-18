// packages/lib/src/channels/__tests__/capabilities.message-type.test.ts
//
// `Message.messageType` is a stored, `NOT NULL` column (message-type-overhaul
// plan §2.7/§3) — it can no longer be a pure function of `Integration.provider`,
// because a call and a text can arrive on the SAME integration. So this test's
// premise is no longer "the two maps agree on what every message reads back
// as" — it is "the two maps agree on the DEFAULT a provider's messages are
// stamped with at write time":
//
//   - `getMessageTypeFromProvider` (`providers/type-utils.ts`) is what
//     `ingest/store-message.ts` falls back to when a provider mapper does not
//     supply a more specific `MessageData.messageType`.
//   - `PLATFORM_CAPABILITIES[provider].messageType` is what the composer
//     stamps on an OUTBOUND row (`messages/message-composer.service.ts`). The
//     composer only ever creates SMS/EMAIL/CHAT rows, so restating the value
//     here stays correct even though the column itself can now diverge from
//     the provider default on individual rows (e.g. an openphone call/voicemail).
//
// The restatement exists because `providers/` has no client-safe subpath and
// the composer needs the same default to stamp an optimistic row with — but
// two per-provider maps is exactly the drift that kept `openphone` out of the
// From picker for months. So they are pinned together here: a provider added
// to one map and not the other, or given a different default in each, is a
// failing test rather than a just-sent SMS that renders as an email card
// until the echo lands.

import { IntegrationProviderTypeValues } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { getMessageTypeFromProvider } from '../../providers/type-utils'
import type { ChannelProviderType } from '../../providers/types'
import { PLATFORM_CAPABILITIES } from '../capabilities'

describe('PlatformCapabilities.messageType (ingest/composer default)', () => {
  it('agrees with the getMessageTypeFromProvider default for every provider', () => {
    for (const provider of IntegrationProviderTypeValues) {
      expect(PLATFORM_CAPABILITIES[provider].messageType).toBe(
        getMessageTypeFromProvider(provider as ChannelProviderType)
      )
    }
  })

  it('declares a default messageType for every provider — no gaps', () => {
    for (const provider of IntegrationProviderTypeValues) {
      expect(PLATFORM_CAPABILITIES[provider].messageType).toBeTruthy()
    }
  })
})
