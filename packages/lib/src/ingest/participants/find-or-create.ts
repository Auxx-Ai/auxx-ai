// packages/lib/src/ingest/participants/find-or-create.ts

import { schema } from '@auxx/database'
import {
  IdentifierType as IdentifierTypeEnum,
  ParticipantRole as ParticipantRoleEnum,
} from '@auxx/database/enums'
import type {
  IdentifierType,
  ParticipantEntity as Participant,
  ParticipantRole,
} from '@auxx/database/types'
import { and, eq, sql } from 'drizzle-orm'
import { buildOrgOwnIdentitySets, isOwnChannelIdentity } from '../../channels/own-identities'
import { classifyIsInternal } from '../../participants/classify-internal'
import { getRealtimeService, publishParticipantUpdated } from '../../realtime'
import type { ParticipantMeta } from '../../realtime/events'
import { findOrCreateContactForParticipant } from '../contacts/find-or-create'
import type { IngestContext } from '../context'
import { getOwnDomains } from '../domain/classifier'
import { getInboxMeta } from '../inbox-meta'
import type { ParticipantInputData } from '../types'
import { calculateDisplayName, calculateInitials } from './display'
import { normalizeIdentifier } from './normalize'

/** Roles that make a participant a recipient of an outbound message. */
const OUTBOUND_RECIPIENT_ROLES: readonly ParticipantRole[] = [
  ParticipantRoleEnum.TO,
  ParticipantRoleEnum.CC,
  ParticipantRoleEnum.BCC,
]

/**
 * Ingest's binding of the shared {@link classifyIsInternal} — supplies the
 * per-batch caches so a batch of N participants doesn't re-read the org cache N
 * times.
 *
 * The classifier itself is shared with `participant-service.ts` on purpose:
 * these two used to be separate implementations that disagreed (this one
 * checked the integration's own addresses, that one only checked org domains),
 * so the same address landed on different verdicts depending on whether it
 * arrived through ingest or through the composer.
 */
async function classifyParticipantIsInternal(
  ctx: IngestContext,
  identifier: string,
  identifierType: IdentifierType
): Promise<boolean> {
  let ownIdentities = ctx.ownIdentitiesByOrg.get(ctx.organizationId)
  if (!ownIdentities) {
    // Lazy import, like `getCachedMembers` below: a static `../../cache` here
    // widens the module graph enough to break collection in the ingest tests.
    const { getOrgCache } = await import('../../cache')
    ownIdentities = buildOrgOwnIdentitySets(await getOrgCache().get(ctx.organizationId, 'channels'))
    ctx.ownIdentitiesByOrg.set(ctx.organizationId, ownIdentities)
  }
  let ownDomains = ctx.ownDomainsByOrg.get(ctx.organizationId)
  if (!ownDomains) {
    ownDomains = await getOwnDomains(ctx.organizationId)
    ctx.ownDomainsByOrg.set(ctx.organizationId, ownDomains)
  }
  return classifyIsInternal({
    organizationId: ctx.organizationId,
    identifier,
    identifierType,
    contextIdentities: ctx.ownIdentities,
    ownIdentities,
    ownDomains,
  })
}

/**
 * Resolve the org-member profile name for an internal participant, so display
 * names for "us" are pinned to the member's profile rather than flip-flopping
 * with whatever name a given message header carried. Two-tier match:
 *   1. identifier == a member's login email → that member's `user.name`;
 *   2. else identifier is one of the active integration's own email identities
 *      (an alias) and the triggering inbox is personal → resolve the inbox
 *      owner → that member's `user.name`.
 * Returns null when no member name resolves (falls back to header-name policy).
 */
async function resolveInternalMemberName(
  ctx: IngestContext,
  identifier: string,
  identifierType: IdentifierType,
  inboxId?: string | null
): Promise<string | null> {
  // EMAIL-only, and not an oversight: both tiers below map an ADDRESS onto a
  // member profile. A phone channel identity has no member behind it — the
  // number belongs to the org, not to a person — so there is nothing to pin and
  // the provider-supplied name (or the formatted number) is the better label.
  if (identifierType !== IdentifierTypeEnum.EMAIL) return null

  const lower = identifier.toLowerCase()
  const { getCachedMembers } = await import('../../cache')
  const members = await getCachedMembers(ctx.organizationId)

  const direct = members.find((m) => m.user?.email?.toLowerCase() === lower)
  if (direct?.user?.name) return direct.user.name

  if (inboxId && isOwnChannelIdentity(ctx.ownIdentities, lower, IdentifierTypeEnum.EMAIL)) {
    const meta = await getInboxMeta(ctx, inboxId)
    if (meta?.isPersonal && meta.ownerUserId) {
      const owner = members.find((m) => m.userId === meta.ownerUserId)
      if (owner?.user?.name) return owner.user.name
    }
  }
  return null
}

/**
 * Upsert a Participant row and ensure it is linked to a Contact EntityInstance
 * (respecting integration record-creation mode). Updates `hasReceivedMessage`
 * and `lastSentMessageAt` when the participant is a recipient on an outbound
 * message — this is how we grow the contact graph in selective mode.
 */
export async function findOrCreateParticipantRecord(
  ctx: IngestContext,
  participantInput: ParticipantInputData,
  identifierType: IdentifierType,
  messageContext?: { isInbound: boolean; role: ParticipantRole; sentAt?: Date },
  /**
   * The inbox the triggering message lands in — routes `participant:updated`
   * to that inbox's lens channels (mail-permissions §6.2). Null/undefined
   * falls back to the admin-only `none` channel.
   */
  inboxId?: string | null,
  /**
   * Hard-tier machine mail (bounces/NDRs) — upsert the Participant row but never
   * find-or-create a Contact EntityInstance from it (backscatter-loop guard).
   */
  skipContactCreation = false
): Promise<Participant> {
  if (!participantInput.identifier) {
    throw new Error('Participant identifier cannot be empty.')
  }
  const normalizedIdentifier = normalizeIdentifier(participantInput.identifier, identifierType)
  const name = participantInput.name?.trim() || null

  try {
    const isOutboundRecipient =
      messageContext &&
      !messageContext.isInbound &&
      OUTBOUND_RECIPIENT_ROLES.includes(messageContext.role)

    const isInternal = await classifyParticipantIsInternal(
      ctx,
      normalizedIdentifier,
      identifierType
    )

    // Name policy (Gmail-parity plan Phase 4): pin internal participants to
    // their org-member profile name; otherwise use the header name. Falls back
    // to the header name when no member name resolves.
    const pinnedName = isInternal
      ? await resolveInternalMemberName(ctx, normalizedIdentifier, identifierType, inboxId)
      : null
    const effectiveName = pinnedName ?? name

    const initials = calculateInitials(effectiveName)
    const displayName = calculateDisplayName(effectiveName, normalizedIdentifier)

    // Capture pre-upsert state so we can detect column changes for
    // participant:updated emission. Cheap point-lookup on the unique index.
    const [previous] = await ctx.db
      .select({
        id: schema.Participant.id,
        name: schema.Participant.name,
        displayName: schema.Participant.displayName,
        hasReceivedMessage: schema.Participant.hasReceivedMessage,
        lastSentMessageAt: schema.Participant.lastSentMessageAt,
        isInternal: schema.Participant.isInternal,
      })
      .from(schema.Participant)
      .where(
        and(
          eq(schema.Participant.organizationId, ctx.organizationId),
          eq(schema.Participant.identifier, normalizedIdentifier),
          eq(schema.Participant.identifierType, identifierType)
        )
      )
      .limit(1)

    const participantData = await ctx.db
      .insert(schema.Participant)
      .values({
        identifier: normalizedIdentifier,
        identifierType,
        name: effectiveName,
        displayName,
        initials,
        organizationId: ctx.organizationId,
        isInternal,
        ...(messageContext && {
          firstInteractionType: messageContext.isInbound ? 'received' : 'sent',
          // The MESSAGE's timestamp, not processing time — under backfill,
          // `new Date()` dated every correspondent's first interaction as
          // connect day. Fall back to now only when no sentAt was supplied.
          firstInteractionDate: messageContext.sentAt ?? new Date(),
          hasReceivedMessage: isOutboundRecipient || false,
          lastSentMessageAt: isOutboundRecipient ? (messageContext.sentAt ?? new Date()) : null,
        }),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.Participant.organizationId,
          schema.Participant.identifier,
          schema.Participant.identifierType,
        ],
        set: {
          // Never downgrade a known name to a bare address: only overwrite
          // name/displayName/initials when this message actually carries a
          // usable name (`effectiveName !== null`). A bare-address message
          // leaves the row's best-known name untouched; a named (or pinned
          // internal) message updates all three together — which also fixes
          // the stale-`initials` asymmetry the old per-field guards caused.
          ...(effectiveName !== null && { name: effectiveName, displayName, initials }),
          // Unconditional last-writer-wins, unlike `name` above. `isInternal` is
          // derived purely from org configuration (connected channels, org
          // domains) and never from message content, so every recomputation is
          // at least as good as the last. Omitting it here — which is what this
          // upsert did until now — froze the column at its first write: adding
          // an org domain or connecting a second channel silently never took
          // effect on rows that already existed, and the `participant:updated`
          // isInternal patch below could never fire.
          isInternal,
          updatedAt: new Date(),
          // First-wins on the message timestamp: backfill batches arrive in
          // arbitrary order, so an older message must be able to claim "first"
          // on the conflict path too — and the type must follow whichever
          // message owns the date.
          ...(messageContext?.sentAt && {
            firstInteractionDate: sql`CASE WHEN ${schema.Participant.firstInteractionDate} IS NULL OR ${schema.Participant.firstInteractionDate} > ${messageContext.sentAt} THEN ${messageContext.sentAt} ELSE ${schema.Participant.firstInteractionDate} END`,
            firstInteractionType: sql`CASE WHEN ${schema.Participant.firstInteractionDate} IS NULL OR ${schema.Participant.firstInteractionDate} > ${messageContext.sentAt} THEN ${messageContext.isInbound ? 'received' : 'sent'} ELSE ${schema.Participant.firstInteractionType} END`,
          }),
          ...(isOutboundRecipient && {
            hasReceivedMessage: true,
            // Last-wins — never rewind under out-of-order processing.
            lastSentMessageAt: messageContext?.sentAt
              ? sql`CASE WHEN ${schema.Participant.lastSentMessageAt} IS NULL OR ${schema.Participant.lastSentMessageAt} < ${messageContext.sentAt} THEN ${messageContext.sentAt} ELSE ${schema.Participant.lastSentMessageAt} END`
              : new Date(),
          }),
        },
      })
      .returning()

    // `INSERT … ON CONFLICT DO UPDATE … RETURNING` always yields exactly one
    // row, so this is a shape assertion. Throwing keeps the caller from linking
    // a message to a participant that was never written.
    const participant = participantData[0]
    if (!participant) {
      throw new Error(
        `Participant upsert returned no row for ${identifierType} ${normalizedIdentifier}`
      )
    }

    // Emit `participant:updated` only when this was an UPDATE (previous row
    // existed) AND at least one tracked column actually changed. New rows
    // don't get a `participant:created` event in v1 — the FE looks them up
    // on demand via `requestParticipant` when a message references them.
    if (previous) {
      const patch: Partial<ParticipantMeta> = {}
      if (participant.name !== previous.name) patch.name = participant.name
      if (participant.displayName !== previous.displayName) {
        // `ParticipantMeta.displayName` is `string | undefined`; the column is
        // nullable. The insert/update path always writes a computed display
        // name (it falls back to the identifier), so null is unreachable here.
        patch.displayName = participant.displayName ?? undefined
      }
      if (participant.hasReceivedMessage !== previous.hasReceivedMessage) {
        patch.hasReceivedMessage = participant.hasReceivedMessage
      }
      const prevSent = previous.lastSentMessageAt?.getTime() ?? null
      const nextSent = participant.lastSentMessageAt?.getTime() ?? null
      if (prevSent !== nextSent) {
        patch.lastSentMessageAt = participant.lastSentMessageAt
          ? participant.lastSentMessageAt.toISOString()
          : null
      }
      if (participant.isInternal !== previous.isInternal) patch.isInternal = participant.isInternal

      if (Object.keys(patch).length > 0) {
        await publishParticipantUpdated(
          getRealtimeService(),
          ctx.organizationId,
          { participantId: participant.id, patch, inboxId },
          { excludeSocketId: ctx.socketId }
        )
      }
    }

    if (!participant.entityInstanceId) {
      const entityInstanceId = await findOrCreateContactForParticipant(
        ctx,
        participant,
        messageContext,
        { skipCreation: skipContactCreation }
      )
      if (entityInstanceId) {
        const updatedParticipants = await ctx.db
          .update(schema.Participant)
          .set({ entityInstanceId, updatedAt: new Date() })
          .where(eq(schema.Participant.id, participant.id))
          .returning()
        const updated = updatedParticipants[0]
        if (updated) return updated
        // Zero rows back means the row we just upserted disappeared between the
        // two statements (concurrent delete/merge). Return the in-memory row
        // carrying the link we tried to write rather than an undefined record.
        ctx.logger.warn('Participant row missing when linking its contact; using in-memory row', {
          participantId: participant.id,
          entityInstanceId,
        })
        return { ...participant, entityInstanceId }
      }
    }

    return participant
  } catch (error) {
    ctx.logger.error('Error upserting participant record:', {
      error,
      identifier: normalizedIdentifier,
      type: identifierType,
    })
    throw error
  }
}
