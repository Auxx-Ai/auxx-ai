// packages/lib/src/webhooks/inbound/secret/resolve.ts
// One read interface over the stores webhook signing secrets live in today: process
// env (configService), the connector handler's `{ secret }` metadata, and an encrypted
// Credential field. Standardizes the READ, not the location — storage migration is
// out of scope (a WebhookSpec-era recommendation, not done here).

import { configService } from '@auxx/credentials'
import { revealSecrets } from '@auxx/credentials/store'
import type { SecretSource } from '../types'

/** Resolve a webhook signing secret from its source. Returns null when absent/unreadable. */
export async function resolveWebhookSecret(source: SecretSource): Promise<string | null> {
  switch (source.kind) {
    case 'env':
      return configService.get<string>(source.key) ?? null

    case 'handlerMetadata': {
      if (!source.metadata) return null
      try {
        return (JSON.parse(source.metadata) as { secret?: string }).secret ?? null
      } catch {
        return null
      }
    }

    case 'credentialField': {
      const revealed = await revealSecrets<{ fields?: Record<string, string> }>(
        source.credentialId,
        source.organizationId
      )
      if (revealed.isErr()) return null
      return revealed.value.secrets.fields?.[source.field] ?? null
    }
  }
}
