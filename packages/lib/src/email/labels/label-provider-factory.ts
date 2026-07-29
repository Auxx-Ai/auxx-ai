// packages/lib/src/email/labels/label-provider-factory.ts

import { BadRequestError } from '../../errors'
import { GmailLabelProvider } from './gmail-label-provider'
import type { LabelProvider } from './label-provider.interface'
import { OutlookLabelProvider } from './outlook-label-provider'

/**
 * Build and initialize the label provider client for one integration.
 *
 * A function, not a static-only class: `LabelProviderFactory` had no state and
 * no instances, so the class was a namespace with extra ceremony (module guide
 * §2 — provider *adapters* are the legitimate class exception, their factory is
 * not).
 *
 * **Throws instead of returning a `Result`** because every caller runs inside a
 * `guard()`ed body, which converts a thrown `AuxxError` into `err(error)` and
 * logs the unexpected rest exactly once. The old implementation wrapped this in
 * its own `try { … } catch { logger.error; throw }`, which produced a duplicate
 * log line for every failure and hid nothing.
 *
 * Unsupported and not-yet-implemented provider types raise
 * {@link BadRequestError} (400) rather than a bare `Error` — a bare `Error` fell
 * through `auxxErrorMiddleware` as a 500, telling the caller "we broke" when the
 * truth is "that provider can't do labels".
 *
 * @param providerType `Integration.provider` — `'google'`, `'outlook'`, …
 */
export async function createLabelProvider(
  organizationId: string,
  integrationId: string,
  providerType: string
): Promise<LabelProvider> {
  switch (providerType) {
    case 'google': {
      const gmailProvider = new GmailLabelProvider(organizationId, integrationId)
      await gmailProvider.initialize()
      return gmailProvider
    }

    case 'outlook': {
      const outlookProvider = new OutlookLabelProvider(organizationId, integrationId)
      await outlookProvider.initialize()
      return outlookProvider
    }

    case 'smtp':
    case 'imap':
      throw new BadRequestError('SMTP/IMAP label provider not yet implemented')

    default:
      throw new BadRequestError(`Unsupported provider type: ${providerType}`)
  }
}
