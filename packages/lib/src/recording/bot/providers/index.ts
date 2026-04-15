// packages/lib/src/recording/bot/providers/index.ts

import { configService } from '@auxx/credentials'
import { BadRequestError } from '../../../errors'
import type { BotProvider, BotProviderId } from '../types'
import { createRecallProvider } from './recall-provider'

/**
 * Get a bot provider instance by ID.
 * Providers are stateless API clients — no caching needed.
 */
export function getProvider(providerId: BotProviderId): BotProvider {
  switch (providerId) {
    case 'recall':
      return createRecallProvider({
        apiKey: configService.get('RECALL_AI_API_KEY'),
        region: configService.get('RECALL_AI_REGION') ?? 'us-west-2',
        webhookSecret: configService.get('RECALL_AI_WEBHOOK_SECRET'),
      })
    default:
      throw new BadRequestError(`Unsupported bot provider: ${providerId}`)
  }
}
