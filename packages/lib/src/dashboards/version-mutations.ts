// packages/lib/src/dashboards/version-mutations.ts

import { type Database, schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../errors'
import { canEditDashboard } from './access'
import type { DashboardLayoutDoc } from './client'
import { hashLayoutDoc } from './config-hash'
import { dashboardLayoutDocSchema, draftLayoutDocSchema } from './config-schemas'
import { getDashboard } from './dashboard-queries'
import type { PublishResult } from './types'

/**
 * Draft/publish lifecycle for a dashboard — the dashboard analogue of
 * `agent-version-service.ts` (`publishAgentTx` / `discardAgentDraft` /
 * `restoreAgentVersion`). The {@link schema.Dashboard} row IS the draft
 * (`draftLayout`); editing auto-saves there (no version), and **publish**
 * snapshots it into an immutable numbered {@link schema.DashboardVersion}.
 * Functional Drizzle, `neverthrow` results.
 *
 * Versions are append-only and never edited, with the single documented
 * exception of {@link renameVersion} (annotation metadata, like `agent.renameVersion`).
 */

/**
 * THE auto-save path. Validates `doc` with the permissive draft schema, writes it
 * to `Dashboard.draftLayout`, and flags `hasUnpublishedChanges` by comparing the
 * draft's hash to the active version's `configHash`. No version is inserted. A
 * plain row update — no lock needed; last write wins, and the previous state is
 * still one publish/version away.
 */
export async function saveDraft(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string,
  doc: DashboardLayoutDoc
): Promise<Result<{ hasUnpublishedChanges: boolean }, Error>> {
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
  if (!canEditDashboard(row, userId)) return err(new ForbiddenError('Not allowed'))

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

  return ok({ hasUnpublishedChanges })
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
      if (!canEditDashboard(row, userId)) return err(new ForbiddenError('Not allowed'))

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

  const dashboardResult = await getDashboard(db, orgId, userId, dashboardId)
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
  userId: string,
  dashboardId: string
): Promise<Result<PublishResult, Error>> {
  const row = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!row || row.archivedAt) return err(new NotFoundError('Dashboard not found'))
  if (!canEditDashboard(row, userId)) return err(new ForbiddenError('Not allowed'))
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

  const dashboardResult = await getDashboard(db, orgId, userId, dashboardId)
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
  userId: string,
  dashboardId: string,
  versionNumber: number
): Promise<Result<PublishResult, Error>> {
  const row = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!row || row.archivedAt) return err(new NotFoundError('Dashboard not found'))
  if (!canEditDashboard(row, userId)) return err(new ForbiddenError('Not allowed'))

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

  const dashboardResult = await getDashboard(db, orgId, userId, dashboardId)
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
  userId: string,
  dashboardId: string,
  versionNumber: number
): Promise<Result<{ versionNumber: number }, Error>> {
  const row = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!row || row.archivedAt) return err(new NotFoundError('Dashboard not found'))
  if (!canEditDashboard(row, userId)) return err(new ForbiddenError('Not allowed'))

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
  userId: string,
  dashboardId: string,
  versionNumber: number,
  label: string | null
): Promise<Result<{ versionNumber: number; label: string | null }, Error>> {
  const dashboard = await db.query.Dashboard.findFirst({
    where: and(eq(schema.Dashboard.id, dashboardId), eq(schema.Dashboard.organizationId, orgId)),
  })
  if (!dashboard || dashboard.archivedAt) return err(new NotFoundError('Dashboard not found'))
  if (!canEditDashboard(dashboard, userId)) return err(new ForbiddenError('Not allowed'))

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
