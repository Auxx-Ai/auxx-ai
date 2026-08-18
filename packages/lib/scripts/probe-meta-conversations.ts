// packages/lib/scripts/probe-meta-conversations.ts
//
// Throwaway diagnostic for the ONE thing WS7 could not verify from a desk: what Graph
// actually returns on the conversation-messages edge.
//
// It answers two open questions, both of which decide whether the backfill is correct:
//
//   1. **Scalar or object?** `GET /{conversationId}/messages?fields=…,message` — is
//      `message` a plain string, or an object with `text`/`mid`/`attachments`? The old
//      sync requested `message{text,attachments,mid}`, which is an invalid expansion on
//      a scalar (and therefore possibly a hard failure), then read `message.mid` off it.
//      `social/conversation-message.ts` tolerates both shapes; this says which one the
//      code should keep.
//
//   2. **Gate step 2b — is it the same id space?** Are the participant ids on
//      `/{pageId}/conversations` the same PSIDs the webhook puts in `sender.id`? If not,
//      the sync computes `dm:{pageId}:{otherIdSpace}` while the webhook computed
//      `dm:{pageId}:{psid}` — two keys, one conversation. Compare the printed
//      participant ids against `Message.metadata.meta_webhook_event.sender.id` for the
//      same customer.
//
// Nothing is written and nothing is ingested — this only reads.
//
// usage: npx dotenv -- npx tsx packages/lib/scripts/probe-meta-conversations.ts <integrationId> [conversationCount]

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { getChannelTokens } from '../src/providers/channel-token-accessor'
import { listConversationMessages, listConversations } from '../src/providers/social/api'
import { socialThreadKey } from '../src/providers/social/thread-key'

const [integrationId, countArg] = process.argv.slice(2)
if (!integrationId) {
  console.error(
    'usage: probe-meta-conversations.ts <integrationId> [conversationCount]\n' +
      '  e.g. npx dotenv -- npx tsx packages/lib/scripts/probe-meta-conversations.ts wz40u14ic6uvliidcbpeojk1'
  )
  process.exit(1)
}
const conversationCount = Number(countArg ?? 3)

const [integration] = await db
  .select({
    id: schema.Integration.id,
    provider: schema.Integration.provider,
    metadata: schema.Integration.metadata,
  })
  .from(schema.Integration)
  .where(eq(schema.Integration.id, integrationId))
  .limit(1)

if (!integration) {
  console.error(`integration ${integrationId} not found`)
  process.exit(1)
}
if (integration.provider !== 'facebook' && integration.provider !== 'instagram') {
  console.error(`integration ${integrationId} is a ${integration.provider} channel, not FB/IG`)
  process.exit(1)
}

const metadata = (integration.metadata ?? {}) as {
  pageId?: string
  pageName?: string
  instagramBusinessAccountId?: string
  instagramUsername?: string
  backfillCutoffAt?: string
  initialBackfillCompletedAt?: string
  backfill?: unknown
}
const pageId = metadata.pageId
if (!pageId) {
  console.error('integration metadata has no pageId')
  process.exit(1)
}

const isInstagram = integration.provider === 'instagram'
// Our identity in the thread key: the Page id on Messenger, the IG business account id
// on Instagram Direct. NOT interchangeable.
const ourId = isInstagram ? (metadata.instagramBusinessAccountId ?? pageId) : pageId

const { accessToken } = await getChannelTokens(integrationId)
if (!accessToken) {
  console.error('no access token on the linked credential')
  process.exit(1)
}

console.log('--- channel -------------------------------------------------------------')
console.log('provider                  :', integration.provider)
console.log('pageId (edge address)     :', pageId)
console.log('ourId  (thread-key side)  :', ourId)
console.log('backfillCutoffAt          :', metadata.backfillCutoffAt ?? '<NOT STAMPED>')
console.log('initialBackfillCompletedAt:', metadata.initialBackfillCompletedAt ?? '<not set>')
console.log('backfill progress         :', JSON.stringify(metadata.backfill ?? null))

console.log('\n--- (a) GET /{pageId}/conversations --------------------------------------')
const conversations = await listConversations({
  pageId,
  pageAccessToken: accessToken,
  platform: isInstagram ? 'instagram' : 'messenger',
  limit: conversationCount,
})
console.log(JSON.stringify(conversations, null, 2))

const first = conversations.data?.[0]
if (!first?.id) {
  console.log('\nno conversations returned — nothing further to probe')
  process.exit(0)
}

// Gate step 2b: this is the id the backfill will key on. Compare it against the PSID in
// a stored webhook payload for the same person.
const participants = first.participants?.data ?? []
const counterpart = participants.find((p) => p.id && p.id !== ourId && p.id !== pageId)
console.log('\n--- (b) derived identity for the first conversation -----------------------')
console.log('conversation id           :', first.id)
console.log('participants             :', JSON.stringify(participants))
console.log('counterpart id           :', counterpart?.id ?? '<NONE FOUND>')
console.log(
  'thread key the sync would write:',
  counterpart?.id ? socialThreadKey(ourId, counterpart.id) : '<n/a>'
)
console.log(
  '  ↳ compare with Message.metadata.meta_webhook_event.sender.id for the same customer;\n' +
    '    a mismatch means the REST and webhook id spaces differ (gate step 2b).'
)

console.log('\n--- (c) GET /{conversationId}/messages -----------------------------------')
const messages = await listConversationMessages({
  conversationId: first.id,
  pageAccessToken: accessToken,
  limit: 5,
})
console.log(JSON.stringify(messages, null, 2))

const sample = messages.data?.[0]
console.log('\n--- the answer -----------------------------------------------------------')
console.log('typeof message.message   :', sample ? typeof sample.message : '<no messages>')
if (sample && sample.message !== null && typeof sample.message === 'object') {
  console.log('message object keys      :', Object.keys(sample.message as object))
  console.log('→ OBJECT shape. Keep the object branch in conversation-message.ts.')
} else if (sample) {
  console.log('→ SCALAR shape, as documented. The object branch can be deleted.')
}
console.log('node id                  :', sample?.id)
console.log(
  '  ↳ if this is an `m_…` string it is almost certainly the same `mid` the webhook\n' +
    '    stamps, which makes the externalId fallback exact rather than merely adequate.'
)

process.exit(0)
