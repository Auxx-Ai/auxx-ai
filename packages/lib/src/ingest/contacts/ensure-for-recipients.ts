// packages/lib/src/ingest/contacts/ensure-for-recipients.ts

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { IngestContext } from '../context'
import { determineIdentifierType, normalizeIdentifier } from '../participants/normalize'
import { createContactAfterOutboundMessage } from './create-after-outbound'

/**
 * When sending in selective mode, make sure a contact exists for each
 * recipient we're about to message. No-op outside selective mode —
 * in `all` mode every participant already becomes a contact during
 * inbound ingest; in `none` mode we deliberately never create.
 */
export async function ensureContactsForRecipients(
  ctx: IngestContext,
  args: { recipients: string[]; integrationId: string }
): Promise<void> {
  const mode = ctx.integrationSettings?.recordCreation?.mode || 'selective'
  if (mode !== 'selective') return

  for (const identifier of args.recipients) {
    if (!identifier) continue

    const identifierType = await determineIdentifierType(ctx, identifier, args.integrationId)
    const normalizedId = normalizeIdentifier(identifier, identifierType)

    const [participant] = await ctx.db
      .select()
      .from(schema.Participant)
      .where(
        and(
          eq(schema.Participant.organizationId, ctx.organizationId),
          eq(schema.Participant.identifier, normalizedId),
          eq(schema.Participant.identifierType, identifierType as any)
        )
      )
      .limit(1)

    if (participant && !participant.entityInstanceId) {
      await createContactAfterOutboundMessage(ctx, participant.id)
    }
  }
}
