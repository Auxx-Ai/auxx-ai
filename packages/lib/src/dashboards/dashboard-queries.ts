// packages/lib/src/dashboards/dashboard-queries.ts

import { type DashboardEntity, type Database, schema } from '@auxx/database'
import { ResourceGranteeType, type Rung } from '@auxx/database/enums'
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError, UnprocessableEntityError } from '../errors'
import { resolveEntityIdFromCache } from '../resources/crud/unified-handler-queries'
import type {
  DashboardLayoutDoc,
  DashboardSummary,
  DashboardVersionSummary,
  DashboardWithLayout,
} from './client'
import { dashboardLayoutDocSchema, draftLayoutDocSchema } from './config-schemas'

/**
 * Read paths for dashboards + their versions. Functional Drizzle, `neverthrow`
 * results. Every query is org-scoped and filters `archivedAt IS NULL`.
 * Enforcement (who may view/edit which dashboard) lives entirely in the router
 * (`ctx.capabilities.assert*Instance('dashboard', id)`, doc 13 §4) — this module
 * is capability-unaware, matching the KB precedent. The active version's layout
 * doc is validated (`dashboardLayoutDocSchema`) before it leaves the server — a
 * persisted doc that somehow fails validation surfaces as
 * `UnprocessableEntityError`, never as a malformed client payload.
 */

const DASHBOARD_KEY = 'dashboard'
const WORKSPACE_BASELINE_GRANTEE = 'org_member'

/**
 * The workspace-baseline `ResourceAccess` permission for one dashboard —
 * `undefined` when no baseline row exists yet. `dashboard` is
 * `baselineAtCreate: true` (doc 13 §0.1), so every dashboard SHOULD carry one
 * after create/migration; a missing row is still treated as private (§3).
 */
export async function getWorkspaceBaselineRung(
  db: Database,
  orgId: string,
  dashboardId: string
): Promise<Rung | undefined> {
  const row = await db.query.ResourceAccess.findFirst({
    where: and(
      eq(schema.ResourceAccess.organizationId, orgId),
      eq(schema.ResourceAccess.entityDefinitionId, DASHBOARD_KEY),
      eq(schema.ResourceAccess.entityInstanceId, dashboardId),
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
      eq(schema.ResourceAccess.granteeId, WORKSPACE_BASELINE_GRANTEE)
    ),
    columns: { rung: true },
  })
  return row?.rung as Rung | undefined
}

/** One non-baseline grant row on a dashboard instance. */
export type DashboardShareRow = {
  entityInstanceId: string
  granteeType: string
  granteeId: string
}

/**
 * Every NON-baseline instance grant on dashboards in this org — grants to a
 * specific user, group, team or **permission profile**. One query, not N+1;
 * scoped to a single dashboard when `dashboardId` is given.
 *
 * `role` rows are excluded because that is the workspace baseline itself, which
 * {@link getWorkspaceBaselineRung} already reads, and `rung: 'none'`
 * rows grant nobody (see `RUNG_ORDER`).
 */
async function loadDashboardShares(
  db: Database,
  orgId: string,
  dashboardId?: string
): Promise<DashboardShareRow[]> {
  const rows = await db
    .select({
      entityInstanceId: schema.ResourceAccess.entityInstanceId,
      granteeType: schema.ResourceAccess.granteeType,
      granteeId: schema.ResourceAccess.granteeId,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, orgId),
        eq(schema.ResourceAccess.entityDefinitionId, DASHBOARD_KEY),
        dashboardId
          ? eq(schema.ResourceAccess.entityInstanceId, dashboardId)
          : isNotNull(schema.ResourceAccess.entityInstanceId),
        ne(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
        ne(schema.ResourceAccess.rung, 'none')
      )
    )
  return rows
    .filter((r) => r.entityInstanceId !== null)
    .map((r) => ({
      entityInstanceId: r.entityInstanceId as string,
      granteeType: r.granteeType as string,
      granteeId: r.granteeId,
    }))
}

/**
 * Private ⇒ the workspace baseline is absent or `'none'` **and** nobody other
 * than the owner holds a grant (doc 13 §3).
 *
 * The second half is new in doc 19 step 9. `isPrivate` used to be derived from
 * the `role:org_member` baseline alone, so a dashboard shared with a group — or,
 * once profile grantees became writable, with a permission profile — was
 * labelled "Private" in every list while other members could open it (19a #14).
 * The owner's own create-time `admin` row is excluded: a dashboard only its
 * creator can reach is still private.
 */
export function isPrivateFromBaseline(
  rung: Rung | undefined,
  shares: DashboardShareRow[] = [],
  ownerId: string | null = null
): boolean {
  if (rung !== undefined && rung !== 'none') return false
  return !shares.some(
    (s) => !(s.granteeType === ResourceGranteeType.user && s.granteeId === ownerId)
  )
}

function toSummary(
  row: DashboardEntity,
  tabCount: number,
  widgetCount: number,
  isPrivate: boolean
): DashboardSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon ?? null,
    isPrivate,
    position: row.position,
    createdById: row.createdById,
    activeVersionId: row.activeVersionId,
    entityDefinitionId: row.entityDefinitionId,
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
 * Every non-archived dashboard in `orgId`, with its workspace-baseline
 * `isPrivate` flag (a single LEFT JOIN, not N+1). Access filtering is the
 * ROUTER's job (`ctx.capabilities.canViewInstance('dashboard', id)`, doc 13
 * §4) — this returns the full org set. Widget/tab counts come from the active
 * version's doc via `jsonb_array_length`. Ordered by `position`, then `name`.
 */
export async function listDashboards(
  db: Database,
  orgId: string
): Promise<Result<DashboardSummary[], Error>> {
  const tabCount = sql<number>`COALESCE(jsonb_array_length(${schema.DashboardVersion.layout} -> 'tabs'), 0)`
  const widgetCount = sql<number>`COALESCE((
    SELECT SUM(jsonb_array_length(t -> 'widgets'))
    FROM jsonb_array_elements(${schema.DashboardVersion.layout} -> 'tabs') AS t
  ), 0)`

  const sharesPromise = loadDashboardShares(db, orgId)

  const rows = await db
    .select({
      dashboard: schema.Dashboard,
      tabCount,
      widgetCount,
      baselineRung: schema.ResourceAccess.rung,
    })
    .from(schema.Dashboard)
    .leftJoin(
      schema.DashboardVersion,
      eq(schema.DashboardVersion.id, schema.Dashboard.activeVersionId)
    )
    .leftJoin(
      schema.ResourceAccess,
      and(
        eq(schema.ResourceAccess.organizationId, orgId),
        eq(schema.ResourceAccess.entityDefinitionId, DASHBOARD_KEY),
        eq(schema.ResourceAccess.entityInstanceId, schema.Dashboard.id),
        eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
        eq(schema.ResourceAccess.granteeId, WORKSPACE_BASELINE_GRANTEE)
      )
    )
    .where(and(eq(schema.Dashboard.organizationId, orgId), isNull(schema.Dashboard.archivedAt)))
    .orderBy(asc(schema.Dashboard.position), asc(schema.Dashboard.name))

  const sharesByDashboard = new Map<string, DashboardShareRow[]>()
  for (const share of await sharesPromise) {
    const bucket = sharesByDashboard.get(share.entityInstanceId) ?? []
    bucket.push(share)
    sharesByDashboard.set(share.entityInstanceId, bucket)
  }

  return ok(
    rows.map((r) =>
      toSummary(
        r.dashboard,
        Number(r.tabCount),
        Number(r.widgetCount),
        isPrivateFromBaseline(
          r.baselineRung as Rung | undefined,
          sharesByDashboard.get(r.dashboard.id) ?? [],
          r.dashboard.createdById
        )
      )
    )
  )
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
async function loadDashboardWithLayout(
  db: Database,
  orgId: string,
  row: DashboardEntity
): Promise<Result<DashboardWithLayout, Error>> {
  if (!row.activeVersionId) return err(new NotFoundError('Dashboard has no active version'))

  const version = await db.query.DashboardVersion.findFirst({
    where: eq(schema.DashboardVersion.id, row.activeVersionId),
  })
  if (!version) return err(new NotFoundError('Active dashboard version not found'))

  const docResult = parseLayoutDoc(version.layout)
  if (docResult.isErr()) return err(docResult.error)

  const draftResult = parseDraftLayoutDoc(row.draftLayout)
  if (draftResult.isErr()) return err(draftResult.error)

  const [baselineRung, shares] = await Promise.all([
    getWorkspaceBaselineRung(db, orgId, row.id),
    loadDashboardShares(db, orgId, row.id),
  ])

  return ok({
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon ?? null,
    isPrivate: isPrivateFromBaseline(baselineRung, shares, row.createdById),
    position: row.position,
    createdById: row.createdById,
    activeVersionId: row.activeVersionId,
    entityDefinitionId: row.entityDefinitionId,
    versionNumber: version.versionNumber,
    layout: docResult.value,
    draftLayout: draftResult.value,
    hasUnpublishedChanges: row.hasUnpublishedChanges,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

/** Selector for {@link getDashboard} — by known id, or by its linked entity def / apiSlug. */
export type DashboardSelector = { id: string } | { entityDefinitionId?: string; slug?: string }

/**
 * Dashboard row + its active version's validated layout doc + version number.
 *
 * By `id`: unknown id is `err(NotFoundError)` (existing behavior, non-null result —
 * every internal caller that already has a concrete dashboard id keeps this branch).
 *
 * By entity (`entityDefinitionId` and/or `slug`): resolves the def id via the org
 * cache, then looks up the org's one LIVE dashboard linked to it. No linked
 * dashboard is `ok(null)` — the empty-state signal, not an error. An unresolvable
 * entity key is `err(NotFoundError)`.
 */
export async function getDashboard(
  db: Database,
  orgId: string,
  selector: { id: string }
): Promise<Result<DashboardWithLayout, Error>>
export async function getDashboard(
  db: Database,
  orgId: string,
  selector: { entityDefinitionId?: string; slug?: string }
): Promise<Result<DashboardWithLayout | null, Error>>
export async function getDashboard(
  db: Database,
  orgId: string,
  selector: DashboardSelector
): Promise<Result<DashboardWithLayout | null, Error>> {
  if ('id' in selector) {
    const rowResult = await loadDashboardRow(db, orgId, selector.id)
    if (rowResult.isErr()) return err(rowResult.error)
    return loadDashboardWithLayout(db, orgId, rowResult.value)
  }

  let entityDefinitionId: string
  try {
    entityDefinitionId = await resolveEntityIdFromCache(orgId, {
      entityDefinitionId: selector.entityDefinitionId,
      apiSlug: selector.slug,
    })
  } catch {
    return err(new NotFoundError('Entity not found'))
  }

  const row = await db.query.Dashboard.findFirst({
    where: and(
      eq(schema.Dashboard.organizationId, orgId),
      eq(schema.Dashboard.entityDefinitionId, entityDefinitionId),
      isNull(schema.Dashboard.archivedAt)
    ),
  })
  if (!row) return ok(null)

  return loadDashboardWithLayout(db, orgId, row)
}

/** Version history (meta only, newest first). Caller must have already gated view access. */
export async function listVersions(
  db: Database,
  orgId: string,
  dashboardId: string
): Promise<Result<DashboardVersionSummary[], Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)

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
  dashboardId: string,
  versionNumber: number
): Promise<Result<{ meta: DashboardVersionSummary; doc: DashboardLayoutDoc }, Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)

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
