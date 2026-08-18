// packages/lib/src/data-deletion/resolve.ts
//
// The join from a Meta callback to our rows. `signed_request.user_id` is the
// ONLY key Meta gives us (plan §3.5) — no email, no page id, no app id, no org —
// and it is an app-scoped id (ASID), the same value `GET /me?fields=id` returns
// for a user token minted for our app, which is exactly how
// `fetchFacebookUserId` stamps `Integration.metadata.userId` at connect time.
// Same keyspace, so the join is direct. It is NOT the page-scoped PSID that
// arrives on messaging webhooks, so a customer who DM'd the Page cannot be
// matched by this callback even in principle.

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { guard } from './guard'

/** One live Facebook/Instagram channel owned by the Facebook login being torn down. */
export interface ResolvedMetaChannel {
  integrationId: string
  organizationId: string
  provider: 'facebook' | 'instagram'
  /**
   * Display name of the Page / IG account, for the notification and email copy.
   * `Integration.name` is set to the IG username / Page name by
   * `upsertSocialIntegration`; `metadata->>'pageName'` is the fallback.
   */
  name: string | null
}

/**
 * Every live Facebook/Instagram channel connected through one Facebook login.
 *
 * Same predicate `isLastChannelForFacebookUser` already runs in production
 * (`providers/social/disconnect.ts:39`), backed by the non-unique partial
 * expression index `Integration_social_userId_idx`. It cannot use
 * `webhookRouteKey` or `email`: both live in UNIQUE indexes, and this join is
 * deliberately many-channels-per-value.
 *
 * ⚠️ **Callers MUST snapshot this whole set before tearing anything down.**
 * `revokeAccess` sets `metadata: null` (`providers/facebook/facebook-oauth.ts:224`),
 * which erases the very `userId` this lookup keys on. Resolving inside the loop
 * would process the first channel and then find nothing — silently leaving the
 * linked Instagram channel connected on a token we just told Meta we deleted.
 *
 * One Facebook login legitimately maps to MULTIPLE channels across MULTIPLE
 * orgs; the linked Instagram row carries the FACEBOOK user id because both
 * providers go through the same `upsertSocialIntegration` (verified live, §3.5).
 *
 * An empty result is a NORMAL, successful outcome — a retry, an already
 * disconnected channel, or a login that never connected one.
 */
export async function resolveMetaChannels(
  db: Database,
  facebookUserId: string
): Promise<Result<ResolvedMetaChannel[], Error>> {
  return guard(
    async () => {
      const rows = await db
        .select({
          integrationId: schema.Integration.id,
          organizationId: schema.Integration.organizationId,
          provider: schema.Integration.provider,
          name: schema.Integration.name,
          pageName: sql<string | null>`${schema.Integration.metadata} ->> 'pageName'`,
        })
        .from(schema.Integration)
        .where(
          and(
            isNull(schema.Integration.deletedAt),
            or(
              eq(schema.Integration.provider, 'facebook'),
              eq(schema.Integration.provider, 'instagram')
            ),
            sql`${schema.Integration.metadata} ->> 'userId' = ${facebookUserId}`
          )
        )

      return rows.map((row) => ({
        integrationId: row.integrationId,
        organizationId: row.organizationId,
        provider: row.provider as 'facebook' | 'instagram',
        name: row.name ?? row.pageName ?? null,
      }))
    },
    'Failed to resolve Meta channels for Facebook user',
    { facebookUserId }
  )
}
