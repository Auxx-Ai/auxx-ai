// packages/lib/src/data-migrations/migrations/071-backfill-outlook-plain-text.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import { createStorageManager } from '../../files/storage/storage-manager'
import { deriveSnippet, deriveTextFromHtml } from '../../ingest/html-to-plain-text'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-071')

/**
 * Messages scanned per keyset page.
 *
 * Smaller than 069/070's batches because this one is not a single statement: each
 * row can cost an object-storage round-trip plus an `html-to-text` pass, so a page
 * is bounded by how much work we want in flight between cursor advances rather
 * than by WAL volume.
 */
const BATCH_SIZE = 200

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 10

/** A message whose `textPlain` is still empty, with everything needed to recover one. */
export interface OutlookTextCandidate {
  id: string
  organizationId: string
  textHtml: string | null
  snippet: string | null
  htmlBodyStorageLocationId: string | null
}

/** The columns this migration writes. `textHtml` and the storage id are never touched. */
export interface MessageTextPatch {
  textPlain: string
  snippet?: string
}

/** Per-org reader for object-backed bodies — the shape of `StorageManager` this uses. */
export interface StoredBodyReader {
  getContent(locationId: string): Promise<Buffer>
}

/** `createStorageManager` is per-org, so the loop asks for one reader per org group. */
export type StoredBodyReaderFactory = (organizationId: string) => StoredBodyReader

/** What a run touched. `failed` counts unreachable bodies, which never abort the run. */
export interface BackfillCounts {
  scanned: number
  updated: number
  skipped: number
  failed: number
}

/**
 * Decide what to write for one candidate row given the HTML recovered for it.
 *
 * Returns `null` when there is nothing to write — either no HTML at all, or HTML
 * that renders to an empty string (a body that is pure markup/tracking pixels).
 * Writing `''` there would leave the row matching the `textPlain IS NULL OR = ''`
 * predicate anyway, so it would be a write that buys nothing.
 *
 * `snippet` is only included when the stored one is missing or blank: a snippet
 * that survived (Graph's `bodyPreview`, or an earlier backfill) is the sender's
 * own preview text and outranks anything derived here.
 */
export function planMessageTextPatch(
  row: Pick<OutlookTextCandidate, 'snippet'>,
  html: string | null
): MessageTextPatch | null {
  if (!html) return null

  const textPlain = deriveTextFromHtml(html)
  if (!textPlain) return null

  return row.snippet?.trim() ? { textPlain } : { textPlain, snippet: deriveSnippet(textPlain) }
}

/**
 * Recover the HTML body for one candidate: the inline column when it survived,
 * otherwise the object-storage blob. Returns `null` when the row carries neither.
 */
async function recoverHtml(
  row: OutlookTextCandidate,
  reader: StoredBodyReader
): Promise<string | null> {
  if (row.textHtml) return row.textHtml
  if (!row.htmlBodyStorageLocationId) return null

  const content = await reader.getContent(row.htmlBodyStorageLocationId)
  return content.toString('utf-8')
}

/**
 * Backfill `Message.textPlain` (and `snippet` when blank) for Outlook messages.
 *
 * Exported separately from the {@link DataMigrationDef} so the storage factory can
 * be substituted in tests without reaching into the module graph.
 */
export async function backfillOutlookPlainText(
  db: Database,
  storageFactory: StoredBodyReaderFactory = createStorageManager
): Promise<BackfillCounts> {
  let cursor = ''
  let batches = 0
  const counts: BackfillCounts = { scanned: 0, updated: 0, skipped: 0, failed: 0 }

  for (;;) {
    const rows: OutlookTextCandidate[] = await db
      .select({
        id: schema.Message.id,
        organizationId: schema.Message.organizationId,
        textHtml: schema.Message.textHtml,
        snippet: schema.Message.snippet,
        htmlBodyStorageLocationId: schema.Message.htmlBodyStorageLocationId,
      })
      .from(schema.Message)
      .innerJoin(schema.Integration, eq(schema.Message.integrationId, schema.Integration.id))
      .where(
        and(
          eq(schema.Integration.provider, 'outlook'),
          gt(schema.Message.id, cursor),
          or(isNull(schema.Message.textPlain), eq(schema.Message.textPlain, ''))
        )
      )
      .orderBy(asc(schema.Message.id))
      .limit(BATCH_SIZE)

    if (rows.length === 0) break

    // The cursor advances past skipped and failed rows too, so a page that
    // recovers nothing still makes progress instead of re-reading itself. Those
    // rows keep matching the predicate, so a later re-run picks them up again.
    cursor = rows[rows.length - 1]!.id
    counts.scanned += rows.length
    batches += 1

    const byOrg = new Map<string, OutlookTextCandidate[]>()
    for (const row of rows) {
      const bucket = byOrg.get(row.organizationId)
      if (bucket) bucket.push(row)
      else byOrg.set(row.organizationId, [row])
    }

    for (const [organizationId, orgRows] of byOrg) {
      const reader = storageFactory(organizationId)

      for (const row of orgRows) {
        let html: string | null
        try {
          html = await recoverHtml(row, reader)
        } catch (error) {
          // A pruned or unreachable blob is one message, not the migration.
          counts.failed += 1
          logger.warn('Could not read stored HTML body; leaving message without text', {
            messageId: row.id,
            organizationId,
            locationId: row.htmlBodyStorageLocationId,
            error: error instanceof Error ? error.message : String(error),
          })
          continue
        }

        const patch = planMessageTextPatch(row, html)
        if (!patch) {
          counts.skipped += 1
          continue
        }

        await db.update(schema.Message).set(patch).where(eq(schema.Message.id, row.id))
        counts.updated += 1
      }
    }

    if (batches % LOG_EVERY === 0) {
      logger.info('Backfilling Outlook Message.textPlain', { ...counts, cursor })
    }

    if (rows.length < BATCH_SIZE) break
  }

  logger.info('Backfilled Outlook Message.textPlain', { ...counts, batches })
  return counts
}

/**
 * Derive `Message.textPlain` (and a `snippet` when there is none) for every
 * Outlook message that has neither.
 *
 * **Why.** Microsoft Graph hands us exactly one `body` with one `contentType`, and
 * the Outlook mapper only ever wrote `textPlain` for the `text` case — so for HTML
 * mail, which is all real mail, it was never populated. `bodyPreview` was missing
 * from the `$select`, so `snippet` was `''` too. Once inbound HTML started being
 * offloaded to object storage, `textHtml` went `NULL` as well and the
 * `textPlain ?? stripHtml(textHtml ?? '')` fallbacks that every text consumer runs
 * (AI compose, learned extraction, chat threads, `hasTextBody`) collapsed to `''`.
 * The mapper fix covers new mail; this covers everything already stored.
 *
 * **Not raw SQL, unlike 068–070.** Most target rows keep their HTML in object
 * storage rather than in a column, so each one needs a `StorageManager.getContent`
 * round-trip and a JS `html-to-text` pass — neither expressible in a statement.
 * The scan is still keyset-paginated on `Message.id` and grouped by
 * `organizationId`, because `createStorageManager` is per-org.
 *
 * **Raw `db.update` on purpose** (project convention for data migrations): the
 * ingest path that normally maintains these columns publishes `message:updated`
 * realtime patches and recomputes thread metadata, which a bulk body backfill has
 * no business firing. It also leaves `updatedAt` alone — this is a repair of what
 * the row always should have carried, not a modification of the message.
 *
 * **Idempotent and resumable.** The `textPlain IS NULL OR = ''` predicate means a
 * re-run only touches what is still empty, which is the shape the runner wants (it
 * restarts a failed migration from the top). An unreadable blob is counted in
 * `failed`, logged, and stepped over — one pruned body must never wedge the run.
 */
export const migration071BackfillOutlookPlainText: DataMigrationDef = {
  id: '071-backfill-outlook-plain-text',
  description: 'Derive Message.textPlain and snippet for Outlook messages that have neither',
  async run(db: Database): Promise<void> {
    await backfillOutlookPlainText(db)
  },
}
