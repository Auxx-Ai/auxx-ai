// lib/email/providers/label-provider-factory.ts

import { createScopedLogger } from '@auxx/logger'
import { GmailLabelProvider } from './gmail-label-provider'
import type { LabelProvider } from './label-provider.interface'
import { OutlookLabelProvider } from './outlook-label-provider'

const logger = createScopedLogger('label-provider-factory')

export class LabelProviderFactory {
  static async createProvider(
    providerType: string,
    organizationId: string,
    integrationId: string
  ): Promise<LabelProvider> {
    try {
      switch (providerType) {
        case 'google': {
          const gmailProvider = new GmailLabelProvider(organizationId, integrationId)
          await gmailProvider.initialize()
          return gmailProvider
        }

        // Add other providers as they are implemented
        case 'outlook': {
          const outlookProvider = new OutlookLabelProvider(organizationId, integrationId)
          await outlookProvider.initialize()
          return outlookProvider
        }

        case 'smtp':
        case 'imap':
          // Return generic email provider when implemented
          throw new Error('SMTP/IMAP label provider not yet implemented')

        default:
          throw new Error(`Unsupported provider type: ${providerType}`)
      }
    } catch (error) {
      logger.error('Error creating label provider:', {
        error,
        providerType,
        organizationId,
        integrationId,
      })
      throw error
    }
  }
}
