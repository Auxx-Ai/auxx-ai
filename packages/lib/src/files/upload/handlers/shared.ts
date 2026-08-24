// packages/lib/src/files/upload/handlers/shared.ts

/**
 * The helpers more than one upload handler needs.
 *
 * Kept deliberately small. A handler is meant to read as a statement of facts
 * about one entity type, so anything shared has to earn its place by being the
 * *same* fact in several handlers — the 24-hour window every temporary upload
 * gets, the org-scoped existence check six handlers perform against six
 * different tables.
 *
 * The declarative limits are NOT here: they live in `UPLOAD_POLICIES`
 * (`files/types/entities.ts`), which is server-free precisely so the browser's
 * pre-flight table can be projected from the same numbers the server enforces.
 */

import type { Database } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { NotFoundError } from '../../../errors'
import type { FilesCtx } from '../../ctx'
import type { PresignedUploadSession } from '../session-types'

/**
 * How long a temporary upload survives before the cleanup sweep may remove it.
 *
 * Twenty-four hours across every entity type that has one, which is what the
 * four separate `new Date(Date.now() + 24 * 60 * 60 * 1000)` literals in
 * `entity-processors.ts` each independently said.
 */
export const TEMP_ASSET_TTL_MS = 24 * 60 * 60 * 1000

/** A table this file can existence-check: an id and an owning organization. */
export type OrgScopedTable = PgTable & {
  id: PgColumn
  organizationId: PgColumn
}

/**
 * Assert that one row exists in the caller's organization.
 *
 * The identity half of the six processors' `validateEntityAccess`, with the
 * table as a parameter instead of six copies of the same three-line `SELECT`.
 *
 * **Behaviour change:** the processors threw bare `Error`s here ("Article not
 * found or access denied"), which the upload routes mapped to a 500 with a
 * canned message. A missing row is a caller mistake, so this is a 404 carrying
 * the real reason. `VisitQcItemProcessor` already did exactly this.
 *
 * @throws {NotFoundError} when no such row exists in `ctx.organizationId`.
 */
export async function assertRowInOrg(
  ctx: FilesCtx,
  table: OrgScopedTable,
  entityId: string,
  label: string
): Promise<void> {
  const [row] = await (ctx.db as Database)
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, entityId), eq(table.organizationId, ctx.organizationId)))
    .limit(1)

  if (!row) throw new NotFoundError(`${label} not found`)
}

/**
 * Which logo column a `metadata.variant` addresses.
 *
 * `KnowledgeBase` and `ChatWidget` carry the same `logoLight`/`logoDark` pair
 * and made the same `variant === 'dark'` choice, so the choice lives here and
 * the two `UPDATE`s stay with their own tables — which is what keeps the column
 * references typed instead of stringly-keyed.
 */
export function logoColumnUpdate(
  variant: unknown,
  externalUrl: string
): { logoDark: string } | { logoLight: string } {
  return variant === 'dark' ? { logoDark: externalUrl } : { logoLight: externalUrl }
}

/** Narrowing helper for the hooks that only act on temporary uploads. */
export function hasTempPrefix(session: PresignedUploadSession, prefix: string): boolean {
  return !!session.entityId?.startsWith(prefix)
}

/** The 24-hour deadline a temporary upload's asset carries. */
export function tempExpiry(now: () => Date): Date {
  return new Date(now().getTime() + TEMP_ASSET_TTL_MS)
}
