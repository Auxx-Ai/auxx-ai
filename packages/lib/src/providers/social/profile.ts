// packages/lib/src/providers/social/profile.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { identifierTypeForProvider } from '../../channels/capabilities'
import { ParticipantService } from '../../participants/participant-service'
import { getChannelTokens } from '../channel-token-accessor'
import { type GraphUserProfile, getUserProfile } from './api'
import type { SocialPlatform } from './types'

const logger = createScopedLogger('social-profile')

/**
 * Build a display label out of whatever a Meta profile node actually carried.
 *
 * Deliberately tolerant of every field being absent: Messenger answers a PSID
 * with `first_name`/`last_name` and Instagram answers an IGSID with
 * `name`/`username`, but a person who restricted profile access is answered
 * with neither — and that must read as "no name available", not as an error.
 *
 * @returns the label, or `undefined` when the node carried nothing usable — in
 * which case the caller leaves the participant on its raw-id fallback.
 */
export function buildSocialDisplayName(
  profile: GraphUserProfile | null | undefined
): string | undefined {
  if (!profile) return undefined

  const fullName = profile.name?.trim()
  if (fullName) return fullName

  const parts = [profile.first_name?.trim(), profile.last_name?.trim()].filter(
    (part): part is string => !!part
  )
  if (parts.length > 0) return parts.join(' ')

  // Instagram's handle is a real, human-recognisable label — better than an
  // IGSID — so it is the last resort before giving up.
  return profile.username?.trim() || undefined
}

/**
 * Does this participant already carry a name worth keeping?
 *
 * The raw id counts as "no name": some rows were written before this resolver
 * existed with the PSID itself as the label, and treating those as named would
 * make the id permanent.
 */
function hasResolvedName(name: string | null | undefined, identifier: string): boolean {
  const trimmed = name?.trim()
  return !!trimmed && trimmed !== identifier
}

/** The inbox whose lens channels a `participant:updated` event routes to. */
async function resolveInboxId(db: Database, integrationId: string): Promise<string | null> {
  const [link] = await db
    .select({ inboxId: schema.InboxIntegration.inboxId })
    .from(schema.InboxIntegration)
    .where(eq(schema.InboxIntegration.integrationId, integrationId))
    .limit(1)
  return link?.inboxId ?? null
}

export interface ResolveSocialCounterpartNameArgs {
  platform: SocialPlatform
  organizationId: string
  integrationId: string
  /** The customer's PSID (Messenger) or IGSID (Instagram Direct). */
  counterpartId: string
  /** Skips the lookup when the caller already knows it. */
  inboxId?: string | null
}

/**
 * Give a Meta DM counterpart a human name.
 *
 * Meta's messaging webhook carries **only `sender.id`** — verified against a
 * real captured payload — so every FB/IG thread renders a raw PSID until
 * something asks Graph who that is. This is that something.
 *
 * Three properties matter, in this order:
 *
 * 1. **It never throws.** Ingest already stored the message by the time this
 *    runs; a missing display name must never turn a delivered message into a
 *    failed webhook (Meta retries those, and eventually disables the
 *    subscription).
 * 2. **It is cached by the data it writes.** One indexed point-lookup on
 *    `(organizationId, identifier, identifierType)` decides whether to spend a
 *    Graph call, so a busy thread costs exactly one profile fetch, ever — no
 *    second cache layer to invalidate.
 * 3. **It writes through the existing seam.** `findOrCreateParticipant` with a
 *    `publish` context diffs the tracked name columns and emits
 *    `participant:updated` on the inbox's lens channels, so open mail lists
 *    flip from PSID to name with no refetch. Its upgrade-only name rule also
 *    makes the write safe to repeat and impossible to downgrade.
 *
 * Call it AFTER the webhook has answered 200 (`after()` in the route handlers),
 * never inline.
 *
 * @returns the name written, or `undefined` when nothing was written — already
 * named, no token, restricted profile, or a Graph failure.
 */
export async function resolveSocialCounterpartName(
  db: Database,
  args: ResolveSocialCounterpartNameArgs
): Promise<string | undefined> {
  const { platform, organizationId, integrationId, counterpartId } = args

  try {
    const identifierType = identifierTypeForProvider(platform)
    if (!identifierType) {
      logger.warn('No identifier type for social platform; skipping name resolution', { platform })
      return undefined
    }

    const [existing] = await db
      .select({ name: schema.Participant.name })
      .from(schema.Participant)
      .where(
        and(
          eq(schema.Participant.organizationId, organizationId),
          eq(schema.Participant.identifier, counterpartId),
          eq(schema.Participant.identifierType, identifierType)
        )
      )
      .limit(1)

    if (existing && hasResolvedName(existing.name, counterpartId)) return undefined

    const tokens = await getChannelTokens(integrationId)
    if (!tokens.accessToken) {
      logger.warn('No page access token; cannot resolve counterpart name', {
        platform,
        integrationId,
      })
      return undefined
    }

    const profile = await getUserProfile({
      platform,
      userId: counterpartId,
      pageAccessToken: tokens.accessToken,
    })
    const name = buildSocialDisplayName(profile)
    if (!name) {
      // Entirely normal: restricted profile access, or a person with no name set.
      logger.debug('Meta profile carried no usable name; keeping the id fallback', {
        platform,
        integrationId,
      })
      return undefined
    }

    const inboxId = args.inboxId ?? (await resolveInboxId(db, integrationId))
    const participantService = new ParticipantService(organizationId, db)
    await participantService.findOrCreateParticipant(
      { identifier: counterpartId, identifierType, name },
      { inboxId }
    )

    logger.info('Resolved Meta counterpart display name', { platform, integrationId })
    return name
  } catch (error) {
    logger.warn('Counterpart name resolution failed (ignored)', {
      platform,
      integrationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
