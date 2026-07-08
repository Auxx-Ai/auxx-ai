// packages/lib/src/dashboards/dashboard-queries.ts

import { type DashboardEntity, type Database, schema } from '@auxx/database'
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../errors'
import { canViewDashboard } from './access'
import type {
  DashboardLayoutDoc,
  DashboardSummary,
  DashboardVersionSummary,
  DashboardVisibility,
  DashboardWithLayout,
} from './client'
import { dashboardLayoutDocSchema, draftLayoutDocSchema } from './config-schemas'

/**
 * Read paths for dashboards + their versions. Functional Drizzle, `neverthrow`
 * results. Every query is org-scoped, filters `archivedAt IS NULL`, and applies
 * {@link canViewDashboard}. The active version's layout doc is validated
 * (`dashboardLayoutDocSchema`) before it leaves the server — a persisted doc that
 * somehow fails validation surfaces as `UnprocessableEntityError`, never as a
 * malformed client payload.
 */

function toSummary(row: DashboardEntity, tabCount: number, widgetCount: number): DashboardSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon ?? null,
    visibility: row.visibility as DashboardVisibility,
    position: row.position,
    createdById: row.createdById,
    activeVersionId: row.activeVersionId,
    tabCount,
    widgetCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Parse a persisted (published) layout jsonb into a validated doc, or an error. */
export function parseLayoutDoc(
  layout: unknown
): Result<DashboardLayoutDoc, UnprocessableEntityError> {
  const parsed = dashboardLayoutDocSchema.safeParse(layout)
  if (!parsed.success) {
    return err(new UnprocessableEntityError(`Invalid dashboard layout: ${parsed.error.message}`))
  }
  return ok(parsed.data as DashboardLayoutDoc)
}

/**
 * Parse a persisted DRAFT layout jsonb (permissive — tolerates unconfigured
 * widgets). `null`/absent column → `null` (readers fall back to the published
 * layout). A malformed draft surfaces as `UnprocessableEntityError`.
 */
export function parseDraftLayoutDoc(
  layout: unknown
): Result<DashboardLayoutDoc | null, UnprocessableEntityError> {
  if (layout == null) return ok(null)
  const parsed = draftLayoutDocSchema.safeParse(layout)
  if (!parsed.success) {
    return err(
      new UnprocessableEntityError(`Invalid dashboard draft layout: ${parsed.error.message}`)
    )
  }
  return ok(parsed.data as DashboardLayoutDoc)
}

/**
 * Dashboards visible to `userId` in `orgId` — org-shared plus the user's own
 * private ones. Widget/tab counts come from the active version's doc via
 * `jsonb_array_length`. Ordered by `position`, then `name`.
 */
export async function listDashboards(
  db: Database,
  orgId: string,
  userId: string
): Promise<Result<DashboardSummary[], Error>> {
  const tabCount = sql<number>`COALESCE(jsonb_array_length(${schema.DashboardVersion.layout} -> 'tabs'), 0)`
  const widgetCount = sql<number>`COALESCE((
    SELECT SUM(jsonb_array_length(t -> 'widgets'))
    FROM jsonb_array_elements(${schema.DashboardVersion.layout} -> 'tabs') AS t
  ), 0)`

  const rows = await db
    .select({
      dashboard: schema.Dashboard,
      tabCount,
      widgetCount,
    })
    .from(schema.Dashboard)
    .leftJoin(
      schema.DashboardVersion,
      eq(schema.DashboardVersion.id, schema.Dashboard.activeVersionId)
    )
    .where(
      and(
        eq(schema.Dashboard.organizationId, orgId),
        isNull(schema.Dashboard.archivedAt),
        or(eq(schema.Dashboard.visibility, 'org'), eq(schema.Dashboard.createdById, userId))
      )
    )
    .orderBy(asc(schema.Dashboard.position), asc(schema.Dashboard.name))

  return ok(rows.map((r) => toSummary(r.dashboard, Number(r.tabCount), Number(r.widgetCount))))
}

/** Load an org-scoped, non-archived dashboard row. Shared by queries + mutations. */
export async function loadDashboardRow(
  db: Database,
  orgId: string,
  dashboardId: string
): Promise<Result<DashboardEntity, NotFoundError>> {
  const row = await db.query.Dashboard.findFirst({
    where: and(
      eq(schema.Dashboard.id, dashboardId),
      eq(schema.Dashboard.organizationId, orgId),
      isNull(schema.Dashboard.archivedAt)
    ),
  })
  if (!row) return err(new NotFoundError('Dashboard not found'))
  return ok(row)
}

/** Dashboard row + its active version's validated layout doc + version number. */
export async function getDashboard(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string
): Promise<Result<DashboardWithLayout, Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)
  const row = rowResult.value

  if (!canViewDashboard(row, userId)) return err(new ForbiddenError('Not allowed'))
  if (!row.activeVersionId) return err(new NotFoundError('Dashboard has no active version'))

  const version = await db.query.DashboardVersion.findFirst({
    where: eq(schema.DashboardVersion.id, row.activeVersionId),
  })
  if (!version) return err(new NotFoundError('Active dashboard version not found'))

  const docResult = parseLayoutDoc(version.layout)
  if (docResult.isErr()) return err(docResult.error)

  const draftResult = parseDraftLayoutDoc(row.draftLayout)
  if (draftResult.isErr()) return err(draftResult.error)

  return ok({
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon ?? null,
    visibility: row.visibility as DashboardVisibility,
    position: row.position,
    createdById: row.createdById,
    activeVersionId: row.activeVersionId,
    versionNumber: version.versionNumber,
    layout: docResult.value,
    draftLayout: draftResult.value,
    hasUnpublishedChanges: row.hasUnpublishedChanges,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

/** Version history (meta only, newest first). Requires view access. */
export async function listVersions(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string
): Promise<Result<DashboardVersionSummary[], Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)
  if (!canViewDashboard(rowResult.value, userId)) return err(new ForbiddenError('Not allowed'))

  const versions = await db
    .select({
      id: schema.DashboardVersion.id,
      versionNumber: schema.DashboardVersion.versionNumber,
      label: schema.DashboardVersion.label,
      editorId: schema.DashboardVersion.editorId,
      createdAt: schema.DashboardVersion.createdAt,
    })
    .from(schema.DashboardVersion)
    .where(eq(schema.DashboardVersion.dashboardId, dashboardId))
    .orderBy(desc(schema.DashboardVersion.versionNumber))

  return ok(
    versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      label: v.label,
      editorId: v.editorId,
      createdAt: v.createdAt.toISOString(),
    }))
  )
}

/** A specific version's meta + validated doc — for history preview / restore. */
export async function getVersion(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string,
  versionNumber: number
): Promise<Result<{ meta: DashboardVersionSummary; doc: DashboardLayoutDoc }, Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)
  if (!canViewDashboard(rowResult.value, userId)) return err(new ForbiddenError('Not allowed'))

  const version = await db.query.DashboardVersion.findFirst({
    where: and(
      eq(schema.DashboardVersion.dashboardId, dashboardId),
      eq(schema.DashboardVersion.versionNumber, versionNumber)
    ),
  })
  if (!version) return err(new NotFoundError('Dashboard version not found'))

  const docResult = parseLayoutDoc(version.layout)
  if (docResult.isErr()) return err(docResult.error)

  return ok({
    meta: {
      id: version.id,
      versionNumber: version.versionNumber,
      label: version.label,
      editorId: version.editorId,
      createdAt: version.createdAt.toISOString(),
    },
    doc: docResult.value,
  })
}
