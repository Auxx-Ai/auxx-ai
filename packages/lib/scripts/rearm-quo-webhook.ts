// packages/lib/scripts/rearm-quo-webhook.ts
// One-off repair: re-arm the Quo message webhook for a channel whose stored `webhookId` points at
// a webhook that no longer exists Quo-side (the create-disabled-then-PATCH-enable sequence that
// shipped in #1646 rolled its own webhook back on every connect).
import { revealSecrets } from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { armQuoWebhook } from '../src/channels/quo-channel'
import { listWebhooks } from '../src/providers/openphone/api'

const [integrationId, organizationId] = process.argv.slice(2)
if (!integrationId || !organizationId) {
  console.error('usage: rearm-quo-webhook.ts <integrationId> <organizationId>')
  process.exit(1)
}

await armQuoWebhook(integrationId, organizationId)

const [row] = await db
  .select({ credentialId: schema.Integration.credentialId, metadata: schema.Integration.metadata })
  .from(schema.Integration)
  .where(eq(schema.Integration.id, integrationId))
  .limit(1)

const revealed = await revealSecrets<{ fields?: Record<string, string> }>(
  row!.credentialId!,
  organizationId
)
const apiKey = revealed.isOk() ? revealed.value.secrets.fields?.apiKey : undefined
const live = await listWebhooks(apiKey!)
console.log('stored webhookId:', (row!.metadata as any)?.webhookId)
console.log(
  'live webhooks:',
  live.map((w) => ({ id: w.id, status: w.status, url: w.url, events: w.events }))
)
process.exit(0)
