// packages/lib/src/connections/pending-selection.ts
// A connect that cannot finish without a user choice, parked on the Credential.
//
// Some providers grant access to MORE than the one thing we provision — a Facebook grant
// reaches every Page the user administers, and only one of them becomes the channel. When the
// list is only knowable AFTER the OAuth hop (unlike Quo, where the API key is pasted into a form
// and the numbers are listed before anything commits), the post-connect hook has to stop short of
// provisioning and leave a marker saying what it is waiting on. This module owns that marker and
// nothing else: no Graph calls, no Integration, no channels.
//
// The envelope is kind-agnostic; the payload is not. `kind` is the discriminator every resume
// path dispatches on, so a second provider is a union member and a `switch` arm rather than a
// reshape of the storage, the hook result, or the resume query.
//
// ⚠️ ORDERING, load-bearing. `saveConnection` REPLACES `Credential.metadata` wholesale on an
// OAuth mint (`updateCredential` does `set.metadata = input.metadata`, not a jsonb merge), and the
// OAuth callback runs it BEFORE `runPostConnectHook`. The merge below therefore protects us from
// everything except that one write, which we survive purely by running after it. A marker written
// before `saveConnection` would be silently erased.

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'

const logger = createScopedLogger('pending-selection')

/** The jsonb key on `Credential.metadata`. Top-level on purpose — see the module note. */
const METADATA_KEY = 'pendingSelection'

/**
 * What the connect is waiting on. One member today.
 *
 * Add a member rather than widening to `string`: the resume query and the picker dialog both
 * switch on this, and an open string type turns a missing arm into a silent no-picker dead end.
 */
export type PendingSelectionKind = 'social-page-selection'

/** A connect parked mid-flight, waiting for the user to choose which resource to provision. */
export interface PendingConnectSelection<T = unknown> {
  kind: PendingSelectionKind
  /** Provider blueprint key the credential was minted for (`facebook`, `instagram`, …). */
  providerKey: string
  /** Kind-specific body. Opaque here — never narrowed in this module. */
  payload: T
  /** ISO stamp, also the sort key for `findPendingSelectionForUser`. */
  createdAt: string
}

/** One pending marker plus the credential it sits on. */
export interface PendingSelectionRow<T = unknown> {
  credentialId: string
  selection: PendingConnectSelection<T>
}

function parseSelection<T>(metadata: unknown): PendingConnectSelection<T> | null {
  const blob = (metadata as Record<string, unknown> | null)?.[METADATA_KEY]
  if (!blob || typeof blob !== 'object') return null
  const candidate = blob as Partial<PendingConnectSelection<T>>
  if (!candidate.kind || !candidate.payload) return null
  return candidate as PendingConnectSelection<T>
}

/**
 * Park a pending selection on a credential.
 *
 * jsonb MERGE, never replace: the connections layer's OAuth bookkeeping and the providers' own
 * caches (`metadata.meta.pages`, `metadata.quo`) live in this same blob.
 */
export async function writePendingSelection<T>(
  credentialId: string,
  organizationId: string,
  selection: Omit<PendingConnectSelection<T>, 'createdAt'> & { createdAt?: string }
): Promise<void> {
  const stored: PendingConnectSelection<T> = {
    ...selection,
    createdAt: selection.createdAt ?? new Date().toISOString(),
  }
  const json = JSON.stringify({ [METADATA_KEY]: stored })
  await db
    .update(schema.Credential)
    .set({
      metadata: sql`COALESCE(${schema.Credential.metadata}, '{}'::jsonb) || ${json}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.Credential.id, credentialId),
        eq(schema.Credential.organizationId, organizationId)
      )
    )
}

/**
 * Read a credential's pending marker back.
 *
 * Org-scoped on purpose: `credentialId` arrives from the client, so the org predicate is the
 * authorization boundary and not a filter. A credential from another org, a missing row, or a
 * credential with no marker all read as `null` — never an error, matching the contract
 * `readCachedQuoNumbers` documents.
 */
export async function readPendingSelection<T>(
  credentialId: string,
  organizationId: string
): Promise<PendingConnectSelection<T> | null> {
  const [row] = await db
    .select({ metadata: schema.Credential.metadata })
    .from(schema.Credential)
    .where(
      and(
        eq(schema.Credential.id, credentialId),
        eq(schema.Credential.organizationId, organizationId)
      )
    )
    .limit(1)
  return row ? parseSelection<T>(row.metadata) : null
}

/**
 * The newest pending marker belonging to one user in one org, if any.
 *
 * Scoped to `createdById` as well as the org: the person who ran the OAuth is the person who
 * finishes it, because the grant (and the app-scoped user id we stamp from it) is theirs.
 * Sorted on the marker's own `createdAt` rather than a row timestamp — `Credential.updatedAt`
 * moves for token refreshes and cache writes, which have nothing to do with connect recency.
 */
export async function findPendingSelectionForUser<T>(
  organizationId: string,
  userId: string,
  kinds?: PendingSelectionKind[]
): Promise<PendingSelectionRow<T> | null> {
  const rows = await db
    .select({ id: schema.Credential.id, metadata: schema.Credential.metadata })
    .from(schema.Credential)
    .where(
      and(
        eq(schema.Credential.organizationId, organizationId),
        eq(schema.Credential.createdById, userId),
        sql`${schema.Credential.metadata} -> ${METADATA_KEY}::text IS NOT NULL`
      )
    )
    .orderBy(sql`${schema.Credential.metadata} -> ${METADATA_KEY}::text ->> 'createdAt' DESC`)
    .limit(10)

  for (const row of rows) {
    const selection = parseSelection<T>(row.metadata)
    if (!selection) continue
    if (kinds && !kinds.includes(selection.kind)) continue
    return { credentialId: row.id, selection }
  }
  return null
}

/**
 * Drop the marker, leaving every other key in the blob intact (`#-` removes one path).
 *
 * Called when the selection is answered. Not called when the user cancels the picker: the
 * marker is what makes "reload and finish later" work, and the short-lived token it sits beside
 * expires on its own within the hour.
 */
export async function clearPendingSelection(
  credentialId: string,
  organizationId: string
): Promise<void> {
  await db
    .update(schema.Credential)
    .set({
      // `jsonb - text` removes one top-level key and leaves the rest of the blob alone.
      metadata: sql`COALESCE(${schema.Credential.metadata}, '{}'::jsonb) - ${METADATA_KEY}::text`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.Credential.id, credentialId),
        eq(schema.Credential.organizationId, organizationId)
      )
    )
}

/**
 * Delete this user's other pending credentials for the same provider, so abandoned connects
 * cannot accumulate.
 *
 * `saveConnection` with no `connectionId` always INSERTs, so a user who starts the picker three
 * times leaves three credentials behind. A pending credential is safe to delete by definition:
 * nothing references it (there is no Integration — that is what "pending" means) and the
 * short-lived token it holds is dying anyway. Caps the orphan count at one per
 * (org, provider, user).
 *
 * Best-effort: a cleanup failure must never fail the connect that triggered it.
 */
export async function deleteSupersededPendingCredentials(args: {
  organizationId: string
  userId: string
  providerKey: string
  /** The credential being connected right now — never deleted. */
  keepCredentialId: string
}): Promise<void> {
  const { organizationId, userId, providerKey, keepCredentialId } = args
  try {
    const rows = await db
      .select({ id: schema.Credential.id, metadata: schema.Credential.metadata })
      .from(schema.Credential)
      .where(
        and(
          eq(schema.Credential.organizationId, organizationId),
          eq(schema.Credential.createdById, userId),
          eq(schema.Credential.type, providerKey),
          sql`${schema.Credential.metadata} -> ${METADATA_KEY}::text IS NOT NULL`
        )
      )

    const stale = rows.filter((row) => row.id !== keepCredentialId && parseSelection(row.metadata))
    if (stale.length === 0) return

    // Belt and braces: only delete rows nothing LIVE points at. A pending credential has no
    // Integration by construction, so a hit here means our own invariant broke — skip it
    // rather than cascade a live channel's credential away.
    //
    // ⚠️ `isNull(deletedAt)` is what makes that reasoning true. Disconnect is a SOFT delete, so a
    // tombstoned Integration keeps pointing at its credential forever — and a connect that died
    // part-way through provisioning leaves exactly that shape. Without this filter the tombstone
    // read as "the invariant broke", the superseded credential was skipped, and its marker
    // survived every subsequent connect: `pendingConnectSelection` kept resuming a picker for a
    // credential whose token had already been swapped away, on every page load, forever. The FK is
    // `ON DELETE SET NULL`, so deleting the credential leaves the tombstone intact and unlinked.
    const { deleteCredential } = await import('@auxx/credentials/store')
    for (const row of stale) {
      const referenced = await db.query.Integration.findFirst({
        where: and(
          eq(schema.Integration.credentialId, row.id),
          isNull(schema.Integration.deletedAt)
        ),
        columns: { id: true },
      })
      if (referenced) {
        // Genuinely live — leave the credential alone, but the marker must still go. A superseded
        // selection can never be completed (a newer connect owns the flow now), so keeping it only
        // means re-offering a choice that cannot be taken.
        logger.warn(
          'Pending credential is referenced by a live Integration — clearing its marker',
          {
            credentialId: row.id,
          }
        )
        await clearPendingSelection(row.id, organizationId).catch(() => {})
        continue
      }
      const deleted = await deleteCredential(row.id, organizationId)
      if (deleted.isErr()) {
        logger.warn('Could not delete superseded pending credential', {
          credentialId: row.id,
          error: deleted.error.message,
        })
        continue
      }
      logger.info('Deleted superseded pending credential', { credentialId: row.id, providerKey })
    }
  } catch (error) {
    logger.warn('Failed to clean up superseded pending credentials', {
      organizationId,
      providerKey,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
