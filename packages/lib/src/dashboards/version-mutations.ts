// packages/lib/src/dashboards/version-mutations.ts

import { type Database, schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../errors'
import type { DashboardLayoutDoc } from './client'
import { hashLayoutDoc } from './config-hash'
import { dashboardLayoutDocSchema, draftLayoutDocSchema } from './config-schemas'
import { getDashboard, parseDraftLayoutDoc } from './dashboard-queries'
import type { PublishResult } from './types'

/**
 * Draft/publish lifecycle for a dashboard — the dashboard analogue of
 * `agent-version-service.ts` (`publishAgentTx` / `discardAgentDraft` /
 * `restoreAgentVersion`). The {@link schema.Dashboard} row IS the draft
 * (`draftLayout`); editing auto-saves there (no version), and **publish**
 * snapshots it into an immutable numbered {@link schema.DashboardVersion}.
 * Enforcement lives entirely in the router (doc 13 §4) — callers must have
 * already asserted `assertEditInstance('dashboard', id)`. Functional Drizzle,
 * `neverthrow` results.
 *
 * Versions are append-only and never edited, with the single documented
 * exception of {@link renameVersion} (annotation metadata, like `agent.renameVersion`).
 */

/**
 * THE auto-save path. Validates `doc` with the permissive draft schema, writes it
 * to `Dashboard.draftLayout`, and flags `hasUnpublishedChanges` by comparing the
 * draft's hash to the active version's `configHash`. No version is inserted.
 *
 * OPTIONALLY compare-and-swap. Pass `expectedLayoutHash` (the hash of the draft
 * you read) and a write that would land on top of someone else's is refused
 * with a {@link ConflictError} instead of silently winning. This matters here
 * more than anywhere else in the product: the dashboard page auto-saves the
 * WHOLE document on an 800ms debounce, so an unguarded second writer does not
 * merge, it replaces. Omit it and the call behaves exactly as it always has,
 * last write wins, which is why no existing caller had to migrate.
 *
 * TWO HASHES live in this function and they answer different questions. The
 * dirty check compares the draft against the ACTIVE VERSION's `configHash`
 * ("does the draft differ from what is published"). The CAS compares the draft
 * against ITSELF over time ("did the draft move under me"). Both are
 * {@link hashLayoutDoc}, and confusing them breaks one of the two silently.
 */
export async function saveDraft(
  db: Database,
  orgId: string,
  dashboardId: string,
  doc: DashboardLayoutDoc,
  opts?: { expectedLayoutHash?: string }
): Promise<Result<{ hasUnpublishedChanges: boolean; layoutHash: string }, Error>> {
  const parsed = draftLayoutDocSchema.safeParse(doc)
  if (!parsed.success) {
    return err(new UnprocessableEntityError(`Invalid dashboard draft: ${parsed.error.message}`))
  }
  const validDoc = parsed.data as DashboardLayoutDoc
  const draftHash = hashLayoutDoc(validDoc)

  const row = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!row || row.archivedAt) return err(new NotFoundError('Dashboard not found'))

  // The CAS, and ONLY when a token was supplied: the whole branch is skipped
  // otherwise so the un-migrated path stays byte-for-byte what it was.
  //
  // Hashed from the PARSED stored draft, not the raw jsonb: the schema strips
  // unknown keys, so parse is a projection and the token a reader minted from
  // `parseDraftLayoutDoc` is a hash of the parsed form. Hashing the column
  // directly would make every comparison a false mismatch.
  if (opts?.expectedLayoutHash !== undefined) {
    const stored = parseDraftLayoutDoc(row.draftLayout)
    if (stored.isErr()) return err(stored.error)
    const storedHash = stored.value ? hashLayoutDoc(stored.value) : undefined
    if (storedHash !== opts.expectedLayoutHash) {
      return err(
        new ConflictError(
          'The dashboard draft changed since you read it, so this write was refused rather ' +
            'than overwriting the newer version. Re-read the dashboard and re-apply the edit.',
          { reason: 'draft-changed-since-read' }
        )
      )
    }
  }

  // Dirty iff the draft differs from the live version (no active version ⇒ dirty).
  let hasUnpublishedChanges = true
  if (row.activeVersionId) {
    const active = await db.query.DashboardVersion.findFirst({
      where: eq(schema.DashboardVersion.id, row.activeVersionId),
      columns: { configHash: true },
    })
    hasUnpublishedChanges = !active || active.configHash !== draftHash
  }

  await db
    .update(schema.Dashboard)
    .set({ draftLayout: validDoc as unknown as Record<string, unknown>, hasUnpublishedChanges })
    .where(eq(schema.Dashboard.id, dashboardId))

  // Returned so a caller can chain it into the next mutation's CAS token
  // without a re-read, which is what makes a multi-tool agent turn cheap.
  return ok({ hasUnpublishedChanges, layoutHash: draftHash })
}

/**
 * THE publish path. Snapshots the row's `draftLayout` into a new numbered version
 * and repoints `activeVersionId`. Validates the draft against the STRICT schema —
 * an unconfigured widget is rejected here (readable `UnprocessableEntityError`),
 * even though auto-save accepted it. A `SELECT … FOR UPDATE` lock serializes
 * concurrent publishes so the version-number race dies at the lock. A publish
 * whose `configHash` matches the active version is a no-op (`unchanged: true`)
 * that just clears the dirty flag.
 */
export async function publishDashboard(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string,
  label?: string | null
): Promise<Result<PublishResult, Error>> {
  const outcome = await db.transaction(
    async (tx): Promise<Result<{ unchanged: boolean }, Error>> => {
      // Serialize concurrent publishes; the version-number race dies here.
      const [row] = await tx
        .select()
        .from(schema.Dashboard)
        .where(
          and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId))
        )
        .for('update')

      if (!row || row.archivedAt) return err(new NotFoundError('Dashboard not found'))

      const parsed = dashboardLayoutDocSchema.safeParse(row.draftLayout)
      if (!parsed.success) {
        return err(
          new UnprocessableEntityError(
            `Cannot publish an incomplete dashboard: ${parsed.error.message}`
          )
        )
      }
      const validDoc = parsed.data as DashboardLayoutDoc
      const configHash = hashLayoutDoc(validDoc)

      // No-op republish: active version already carries this exact doc.
      if (row.activeVersionId) {
        const active = await tx.query.DashboardVersion.findFirst({
          where: eq(schema.DashboardVersion.id, row.activeVersionId),
        })
        if (active && active.configHash === configHash) {
          if (row.hasUnpublishedChanges) {
            await tx
              .update(schema.Dashboard)
              .set({ hasUnpublishedChanges: false })
              .where(eq(schema.Dashboard.id, dashboardId))
          }
          return ok({ unchanged: true })
        }
      }

      const [{ next } = { next: 1 }] = await tx
        .select({
          next: sql<number>`COALESCE(MAX(${schema.DashboardVersion.versionNumber}), 0) + 1`,
        })
        .from(schema.DashboardVersion)
        .where(eq(schema.DashboardVersion.dashboardId, dashboardId))

      const versionId = generateId()
      await tx.insert(schema.DashboardVersion).values({
        id: versionId,
        organizationId: orgId,
        dashboardId,
        versionNumber: Number(next),
        label: label ?? null,
        layout: validDoc as unknown as Record<string, unknown>,
        configHash,
        editorId: userId,
      })
      await tx
        .update(schema.Dashboard)
        .set({ activeVersionId: versionId, hasUnpublishedChanges: false })
        .where(eq(schema.Dashboard.id, dashboardId))

      return ok({ unchanged: false })
    }
  )

  if (outcome.isErr()) return err(outcome.error)

  const dashboardResult = await getDashboard(db, orgId, { id: dashboardId })
  if (dashboardResult.isErr()) return err(dashboardResult.error)
  return ok({ dashboard: dashboardResult.value, unchanged: outcome.value.unchanged })
}

/**
 * Discard draft edits — copy the active version's layout back onto `draftLayout`
 * and clear the dirty flag. The dashboard analogue of `discardAgentDraft`.
 */
export async function discardDashboardDraft(
  db: Database,
  orgId: string,
  dashboardId: string
): Promise<Result<PublishResult, Error>> {
  const row = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!row || row.archivedAt) return err(new NotFoundError('Dashboard not found'))
  if (!row.activeVersionId) return err(new NotFoundError('Dashboard has no active version'))

  const active = await db.query.DashboardVersion.findFirst({
    where: eq(schema.DashboardVersion.id, row.activeVersionId),
    columns: { layout: true },
  })
  if (!active) return err(new NotFoundError('Active dashboard version not found'))

  await db
    .update(schema.Dashboard)
    .set({ draftLayout: active.layout, hasUnpublishedChanges: false })
    .where(eq(schema.Dashboard.id, dashboardId))

  const dashboardResult = await getDashboard(db, orgId, { id: dashboardId })
  if (dashboardResult.isErr()) return err(dashboardResult.error)
  return ok({ dashboard: dashboardResult.value, unchanged: false })
}

/**
 * Restore-as-draft (article/agent semantic): copy a published version's layout
 * onto `draftLayout` and mark dirty by hash-compare against the ACTIVE version
 * (restoring the already-active version ≙ discard, not dirty). `activeVersionId`
 * is NOT touched — nothing goes live until the user Publishes. Mirrors
 * `restoreAgentVersion`.
 */
export async function restoreVersion(
  db: Database,
  orgId: string,
  dashboardId: string,
  versionNumber: number
): Promise<Result<PublishResult, Error>> {
  const row = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!row || row.archivedAt) return err(new NotFoundError('Dashboard not found'))

  const target = await db.query.DashboardVersion.findFirst({
    where: and(
      eq(schema.DashboardVersion.dashboardId, dashboardId),
      eq(schema.DashboardVersion.versionNumber, versionNumber)
    ),
  })
  if (!target) return err(new NotFoundError('Dashboard version not found'))

  // Dirty iff the restored layout differs from the live one.
  let hasUnpublishedChanges = true
  if (row.activeVersionId) {
    const active = await db.query.DashboardVersion.findFirst({
      where: eq(schema.DashboardVersion.id, row.activeVersionId),
      columns: { configHash: true },
    })
    hasUnpublishedChanges = !active || active.configHash !== target.configHash
  }

  await db
    .update(schema.Dashboard)
    .set({ draftLayout: target.layout, hasUnpublishedChanges })
    .where(eq(schema.Dashboard.id, dashboardId))

  const dashboardResult = await getDashboard(db, orgId, { id: dashboardId })
  if (dashboardResult.isErr()) return err(dashboardResult.error)
  return ok({ dashboard: dashboardResult.value, unchanged: false })
}

/**
 * Delete a published version. The active version is protected — you cannot
 * delete the snapshot the dashboard is currently pointing at (mirrors
 * `workflow-version-service.deleteVersion`). Every other numbered snapshot is
 * removable; `Dashboard.activeVersionId` is a no-FK pointer and nothing else
 * references a {@link schema.DashboardVersion} row, so the delete is clean and
 * an already-restored draft (a copy) is unaffected.
 */
export async function deleteVersion(
  db: Database,
  orgId: string,
  dashboardId: string,
  versionNumber: number
): Promise<Result<{ versionNumber: number }, Error>> {
  const row = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!row || row.archivedAt) return err(new NotFoundError('Dashboard not found'))

  const target = await db.query.DashboardVersion.findFirst({
    where: and(
      eq(schema.DashboardVersion.dashboardId, dashboardId),
      eq(schema.DashboardVersion.versionNumber, versionNumber)
    ),
    columns: { id: true },
  })
  if (!target) return err(new NotFoundError('Dashboard version not found'))

  if (row.activeVersionId === target.id) {
    return err(new UnprocessableEntityError('Cannot delete the live version'))
  }

  await db.delete(schema.DashboardVersion).where(eq(schema.DashboardVersion.id, target.id))

  return ok({ versionNumber })
}

/**
 * Rename a version — the one permitted write to a published row (annotation
 * metadata only, like `agent.renameVersion`).
 */
export async function renameVersion(
  db: Database,
  orgId: string,
  dashboardId: string,
  versionNumber: number,
  label: string | null
): Promise<Result<{ versionNumber: number; label: string | null }, Error>> {
  const dashboard = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!dashboard || dashboard.archivedAt) return err(new NotFoundError('Dashboard not found'))

  const updated = await db
    .update(schema.DashboardVersion)
    .set({ label })
    .where(
      and(
        eq(schema.DashboardVersion.dashboardId, dashboardId),
        eq(schema.DashboardVersion.versionNumber, versionNumber)
      )
    )
    .returning({
      versionNumber: schema.DashboardVersion.versionNumber,
      label: schema.DashboardVersion.label,
    })

  if (updated.length === 0) return err(new NotFoundError('Dashboard version not found'))
  return ok({ versionNumber: updated[0]!.versionNumber, label: updated[0]!.label })
}
