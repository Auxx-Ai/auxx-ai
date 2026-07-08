// packages/lib/src/dashboards/version-mutations.ts

import { type Database, schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../errors'
import { canEditDashboard } from './access'
import type { DashboardLayoutDoc } from './client'
import { hashLayoutDoc } from './config-hash'
import { dashboardLayoutDocSchema } from './config-schemas'
import { getDashboard, parseLayoutDoc } from './dashboard-queries'
import type { PublishResult } from './types'

/**
 * Save-as-publish versioning: each save validates the client draft, inserts an
 * immutable numbered {@link schema.DashboardVersion}, and repoints
 * `Dashboard.activeVersionId` — all in one transaction that takes a
 * `SELECT … FOR UPDATE` lock on the dashboard row first, so concurrent publishes
 * serialize and the version-number race dies at the lock.
 *
 * **Concurrency model:** last save wins, but nothing is lost — a losing writer's
 * work is still a numbered version one restore away. (Strictly better than a
 * diff-save that could silently drop an edit.)
 *
 * Versions are append-only and never edited, with the single documented
 * exception of `renameVersion` (annotation metadata, like `agent.renameVersion`).
 */

/**
 * THE save path. Validates `doc`, and if its `configHash` differs from the
 * active version's, inserts version N+1 and repoints the pointer. A publish whose
 * hash matches the active version is a no-op (`unchanged: true`).
 */
export async function publishLayout(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string,
  doc: DashboardLayoutDoc
): Promise<Result<PublishResult, Error>> {
  const parsed = dashboardLayoutDocSchema.safeParse(doc)
  if (!parsed.success) {
    return err(new UnprocessableEntityError(`Invalid dashboard layout: ${parsed.error.message}`))
  }
  const validDoc = parsed.data as DashboardLayoutDoc
  const configHash = hashLayoutDoc(validDoc)

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

      // No-op republish: active version already carries this exact doc.
      if (row.activeVersionId) {
        const active = await tx.query.DashboardVersion.findFirst({
          where: eq(schema.DashboardVersion.id, row.activeVersionId),
        })
        if (active && active.configHash === configHash) return ok({ unchanged: true })
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
        layout: validDoc as unknown as Record<string, unknown>,
        configHash,
        editorId: userId,
      })
      await tx
        .update(schema.Dashboard)
        .set({ activeVersionId: versionId })
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
 * Restore = copy-forward: republish the target version's doc as a new
 * higher-numbered version. Runs through {@link publishLayout}, so restoring the
 * already-active version is a no-op.
 */
export async function restoreVersion(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string,
  versionNumber: number
): Promise<Result<PublishResult, Error>> {
  const target = await db.query.DashboardVersion.findFirst({
    where: and(
      eq(schema.DashboardVersion.dashboardId, dashboardId),
      eq(schema.DashboardVersion.versionNumber, versionNumber)
    ),
  })
  if (!target) return err(new NotFoundError('Dashboard version not found'))

  const docResult = parseLayoutDoc(target.layout)
  if (docResult.isErr()) return err(docResult.error)

  return publishLayout(db, orgId, userId, dashboardId, docResult.value)
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
