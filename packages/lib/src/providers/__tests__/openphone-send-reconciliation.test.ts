// packages/lib/src/providers/__tests__/openphone-send-reconciliation.test.ts

import { IntegrationProviderType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { PROVIDER_CAPABILITIES } from '../provider-capabilities'

describe('Quo send reconciliation', () => {
  /**
   * A regression pin, not a tautology. `requiresSendReconciliation: false` is what gated
   * `MessageReconcilerService`'s thread-level branch off — the branch that stamps the provider's
   * `conversationId` onto `Thread.externalId` and registers the `ThreadExternalKey` alias.
   *
   * With it false, an Auxx-composed SMS produced a thread with no conversation key, so the
   * customer's reply had nothing to match and opened a second thread. SMS carries no subject and
   * no Message-ID, so that key is the channel's ONLY threading signal — there is no second
   * mechanism to fall back on the way email has RFC 5322 parentage.
   */
  it('is enabled for openphone, because the conversation key is the only threading signal', () => {
    expect(
      PROVIDER_CAPABILITIES[IntegrationProviderType.openphone].requiresSendReconciliation
    ).toBe(true)
  })

  it('is enabled for every provider whose send response carries thread state', () => {
    // Chat echoes our own thread id back, so reconciling would clobber thread metadata — it is
    // deliberately false there. This asserts the SMS/email side stays on.
    for (const provider of [
      IntegrationProviderType.google,
      IntegrationProviderType.outlook,
      IntegrationProviderType.openphone,
    ]) {
      expect(PROVIDER_CAPABILITIES[provider].requiresSendReconciliation).toBe(true)
    }
  })
})
