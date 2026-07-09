// packages/lib/scripts/repair-personal-inbox-parity.ts
//
// One-off repair for the Gmail-parity plan (Phase 2). For each personal-channel
// Gmail integration it:
//   1. Pages the live Gmail INBOX (labelIds: ['INBOX']) → set of external ids.
//   2. Threads with >=1 inbox message -> OPEN; every other thread of that
//      integration -> ARCHIVED (skipping TRASH/SPAM). Status is the only thing
//      persisted — no label stamping.
//   3. Re-trims quote-led participant names and pins internal participants to
//      their org-member profile name.
//   4. Enqueues a mail-counts reconcile for the affected owner so badges match.
//
// Idempotent — safe to re-run. Run ONLY after Phase 1 ships and the backfill
// has finished.
//
// Run: npx dotenv -- node --conditions source --import tsx/esm \
//        packages/lib/scripts/repair-personal-inbox-parity.ts [integrationId]

import { closePools, database as db, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { google } from 'googleapis'
import { getCachedMembers, getOrgCache } from '../src/cache'
import { calculateDisplayName, calculateInitials } from '../src/ingest/participants/display'
import { getChannelAccessToken, getChannelTokens } from '../src/providers/channel-token-accessor'
import { GoogleOAuthService } from '../src/providers/google/google-oauth'
import { stripBoundaryQuotes } from '../src/providers/provider-utils'
import { enqueueMailCountsReconcile } from '../src/threads/mail-counts'

/* eslint-disable no-console */

const SKIP_STATUSES = new Set(['TRASH', 'SPAM'])
const onlyIntegrationId = process.argv[2]

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Build an authenticated Gmail client for an integration. */
async function buildGmailClient(integrationId: string, organizationId: string) {
  const tokens = await getChannelTokens(integrationId)
  const freshAccessToken = await getChannelAccessToken(integrationId)
  const { client } = await GoogleOAuthService.getAuthenticatedClientForOrg(organizationId, {
    ...tokens,
    accessToken: freshAccessToken ?? tokens.accessToken,
  })
  return google.gmail({ version: 'v1', auth: client })
}

/** All external message ids currently carrying the Gmail INBOX label. */
async function fetchGmailInboxIds(integrationId: string, organizationId: string) {
  const gmail = await buildGmailClient(integrationId, organizationId)
  const ids = new Set<string>()
  let pageToken: string | undefined | null
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 500,
      pageToken: pageToken ?? undefined,
      fields: 'messages/id,nextPageToken',
    })
    for (const m of res.data.messages ?? []) if (m.id) ids.add(m.id)
    pageToken = res.data.nextPageToken
  } while (pageToken)
  return ids
}

/** Repair thread statuses for one personal Gmail integration. */
async function repairThreadStatuses(integrationId: string, organizationId: string) {
  const inboxExternalIds = await fetchGmailInboxIds(integrationId, organizationId)
  console.log(`  gmail INBOX message ids: ${inboxExternalIds.size}`)

  // In-memory join (backfills are dev-scale) — which threads have any INBOX message.
  const messages = await db
    .select({ threadId: schema.Message.threadId, externalId: schema.Message.externalId })
    .from(schema.Message)
    .where(eq(schema.Message.integrationId, integrationId))

  const openThreadIds = new Set<string>()
  for (const m of messages) {
    if (m.threadId && m.externalId && inboxExternalIds.has(m.externalId)) {
      openThreadIds.add(m.threadId)
    }
  }

  const threads = await db
    .select({ id: schema.Thread.id, status: schema.Thread.status })
    .from(schema.Thread)
    .where(eq(schema.Thread.integrationId, integrationId))

  const toOpen = threads
    .filter((t) => openThreadIds.has(t.id) && t.status === 'ARCHIVED')
    .map((t) => t.id)
  const toArchive = threads
    .filter(
      (t) => !openThreadIds.has(t.id) && t.status !== 'ARCHIVED' && !SKIP_STATUSES.has(t.status)
    )
    .map((t) => t.id)

  for (const ids of chunk(toOpen, 500)) {
    await db.update(schema.Thread).set({ status: 'OPEN' }).where(inArray(schema.Thread.id, ids))
  }
  for (const ids of chunk(toArchive, 500)) {
    await db.update(schema.Thread).set({ status: 'ARCHIVED' }).where(inArray(schema.Thread.id, ids))
  }
  console.log(`  threads reopened: ${toOpen.length}, archived: ${toArchive.length}`)
}

/**
 * Re-trim quote-led participant names and pin internal participants to their
 * org-member profile name. Recomputes displayName + initials whenever a row is
 * touched (fixing the stale-initials asymmetry).
 */
async function repairParticipants(organizationId: string) {
  const members = await getCachedMembers(organizationId)
  const memberByEmail = new Map<string, string>()
  for (const m of members) {
    if (m.user?.email && m.user.name) memberByEmail.set(m.user.email.toLowerCase(), m.user.name)
  }

  const participants = await db
    .select({
      id: schema.Participant.id,
      identifier: schema.Participant.identifier,
      name: schema.Participant.name,
      isInternal: schema.Participant.isInternal,
    })
    .from(schema.Participant)
    .where(eq(schema.Participant.organizationId, organizationId))

  let updated = 0
  for (const p of participants) {
    const pinned = p.isInternal ? memberByEmail.get(p.identifier.toLowerCase()) : undefined
    const cleaned = p.name ? stripBoundaryQuotes(p.name) || null : null
    const nextName = pinned ?? cleaned

    if (!nextName || nextName === p.name) continue
    await db
      .update(schema.Participant)
      .set({
        name: nextName,
        displayName: calculateDisplayName(nextName, p.identifier),
        initials: calculateInitials(nextName),
        updatedAt: new Date(),
      })
      .where(eq(schema.Participant.id, p.id))
    updated++
  }
  console.log(`  participants repaired: ${updated}`)
}

async function main() {
  // Google integrations joined to their (personal?) inbox mapping.
  const rows = await db
    .select({
      integrationId: schema.Integration.id,
      organizationId: schema.Integration.organizationId,
      inboxId: schema.InboxIntegration.inboxId,
    })
    .from(schema.Integration)
    .innerJoin(
      schema.InboxIntegration,
      eq(schema.InboxIntegration.integrationId, schema.Integration.id)
    )
    .where(
      and(
        eq(schema.Integration.provider, 'google'),
        isNull(schema.Integration.deletedAt),
        onlyIntegrationId ? eq(schema.Integration.id, onlyIntegrationId) : undefined
      )
    )

  const affectedOwnersByOrg = new Map<string, Set<string>>()
  const repairedOrgs = new Set<string>()

  for (const row of rows) {
    const inboxes = await getOrgCache().get(row.organizationId, 'inboxes')
    const inbox = inboxes.find((i) => i.id === row.inboxId)
    if (!inbox?.isPersonal) continue

    console.log(`\nRepairing integration ${row.integrationId} (inbox ${inbox.name})`)
    try {
      await repairThreadStatuses(row.integrationId, row.organizationId)
    } catch (error) {
      console.error(`  thread-status repair failed:`, (error as Error).message)
    }

    if (!repairedOrgs.has(row.organizationId)) {
      await repairParticipants(row.organizationId)
      repairedOrgs.add(row.organizationId)
    }

    if (inbox.ownerUserId) {
      const set = affectedOwnersByOrg.get(row.organizationId) ?? new Set<string>()
      set.add(inbox.ownerUserId)
      affectedOwnersByOrg.set(row.organizationId, set)
    }
  }

  // Reconcile counts for each affected (org, owner) so badges settle.
  for (const [orgId, owners] of affectedOwnersByOrg) {
    for (const userId of owners) {
      await enqueueMailCountsReconcile(orgId, userId)
      console.log(`Enqueued mail-counts reconcile for ${orgId} / ${userId}`)
    }
  }

  console.log('\n✓ repair complete')
}

main()
  .then(async () => {
    await closePools()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error(error)
    await closePools()
    process.exit(1)
  })
