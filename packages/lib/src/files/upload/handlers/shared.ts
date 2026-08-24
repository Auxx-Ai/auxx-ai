// packages/lib/src/files/upload/handlers/shared.ts

/**
 * The constants and two helpers more than one upload handler needs.
 *
 * Kept deliberately small. A handler is meant to read as a statement of facts
 * about one entity type, so anything shared has to earn its place by being the
 * *same* fact in several handlers — a MIME list three logos agree on, the 24-hour
 * window every temporary upload gets, the org-scoped existence check six
 * handlers perform against six different tables.
 */

import type { Database } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { NotFoundError } from '../../../errors'
import type { FilesCtx } from '../../ctx'
import type { PresignedUploadSession } from '../session-types'

export const MB = 1024 * 1024

/** Every asset-backed entity signs for at most ten minutes. `FILE` is the exception. */
export const ASSET_MAX_TTL_SEC = 10 * 60

/**
 * How long a temporary upload survives before the cleanup sweep may remove it.
 *
 * Twenty-four hours across every entity type that has one, which is what the
 * four separate `new Date(Date.now() + 24 * 60 * 60 * 1000)` literals in
 * `entity-processors.ts` each independently said.
 */
export const TEMP_ASSET_TTL_MS = 24 * 60 * 60 * 1000

/**
 * MIME types accepted for dataset documents.
 *
 * The empty string and `application/octet-stream` are both here on purpose:
 * a browser that cannot type a file by extension sends one or the other, and
 * dataset ingestion sniffs the content itself downstream.
 */
export const DATASET_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/x-markdown',
  'text/x-web-markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/tsv',
  'application/json',
  'application/x-ndjson',
  'application/jsonl',
  'text/json',
  'application/xml',
  'text/xml',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'application/yaml',
  'text/css',
  'text/javascript',
  'application/javascript',
  'text/x-python',
  'text/x-sql',
  'text/x-log',
  'text/log',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/pdf',
  'text/html',
  'application/xhtml+xml',
  'application/zip',
  'application/x-zip-compressed',
  'message/rfc822',
  'application/vnd.ms-outlook',
  'application/epub+zip',
  'application/rtf',
  '',
  'application/octet-stream',
] as const

/**
 * Raster images only, and never an `image/*` wildcard: that would admit
 * `image/svg+xml`, and an uploaded SVG can carry `<script>` that runs in our
 * origin when the object is opened directly.
 */
export const LOGO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

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
