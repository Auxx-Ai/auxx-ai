// packages/lib/src/dashboards/dashboard-mutations.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { generateId } from '@auxx/utils'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedResources } from '../cache'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import { emitResourceAccessInstanceChanged } from '../resource-access'
import { createStarterLayoutDoc, type DashboardLayoutDoc, type DashboardWithLayout } from './client'
import { hashLayoutDoc } from './config-hash'
import {
  getDashboard,
  getWorkspaceBaselinePermission,
  loadDashboardRow,
  parseLayoutDoc,
} from './dashboard-queries'

/**
 * Write paths for dashboard identity/access + lifecycle. Version content is
 * owned by `version-mutations.ts`; the only version write here is the v1 insert
 * that every create/duplicate performs in the same transaction as the row. Never
 * touches an existing version. Enforcement lives entirely in the router
 * (doc 13 §4) — every gate here (`canEditDashboard` et al.) is gone; callers must
 * have already asserted the right instance-access level. Functional Drizzle,
 * `neverthrow` results.
 */

const DASHBOARD_KEY = 'dashboard'
const WORKSPACE_BASELINE_GRANTEE = 'org_member'

export type CreateDashboardInput = {
  name: string
  description?: string | null
  icon?: { iconId: string; color: string }
  /** Private (workspace baseline `'none'`) vs shared with org (`'view'`). Default `false` (shared). */
  isPrivate?: boolean
  /** Links the new dashboard as THE dashboard for this entity def (see `getDashboard`). */
  entityDefinitionId?: string
}

/**
 * Grantees affected by a dashboard's create-time (or duplicate-time) baseline
 * write — the workspace-baseline role grant, plus the owner's `admin` grant when
 * there's a human owner. Feeds {@link emitResourceAccessInstanceChanged}.
 */
function baselineGrantees(
  ownerId: string | null
): Array<{ granteeType: ResourceGranteeType; granteeId: string }> {
  const grantees: Array<{ granteeType: ResourceGranteeType; granteeId: string }> = [
    { granteeType: ResourceGranteeType.role, granteeId: WORKSPACE_BASELINE_GRANTEE },
  ]
  if (ownerId) grantees.push({ granteeType: ResourceGranteeType.user, granteeId: ownerId })
  return grantees
}

/**
 * Insert the two instance-access rows a dashboard is born with (doc 13 §2): the
 * workspace baseline (`'none'` when private, `'view'` when shared) and, when
 * there's a human owner, an `admin` grant for them. MUST run in the same
 * transaction as the `Dashboard` row insert — `dashboard` is
 * `baselineAtCreate: true`, so a dashboard born without these rows is invisible
 * to everyone including its creator until they exist (doc 13 §4 caveat).
 */
async function insertInstanceAccessBaseline(
  tx: Transaction,
  orgId: string,
  dashboardId: string,
  opts: { isPrivate: boolean; ownerId: string | null }
): Promise<void> {
  const rows: (typeof schema.ResourceAccess.$inferInsert)[] = [
    {
      organizationId: orgId,
      entityDefinitionId: DASHBOARD_KEY,
      entityInstanceId: dashboardId,
      granteeType: ResourceGranteeType.role,
      granteeId: WORKSPACE_BASELINE_GRANTEE,
      permission: opts.isPrivate ? ResourcePermission.none : ResourcePermission.view,
      grantedById: opts.ownerId,
    },
  ]
  if (opts.ownerId) {
    rows.push({
      organizationId: orgId,
      entityDefinitionId: DASHBOARD_KEY,
      entityInstanceId: dashboardId,
      granteeType: ResourceGranteeType.user,
      granteeId: opts.ownerId,
      permission: ResourcePermission.admin,
      grantedById: opts.ownerId,
    })
  }
  await tx.insert(schema.ResourceAccess).values(rows).onConflictDoNothing()
}

/** The entity def exists and belongs to this org, or `err(BadRequestError)`. */
async function assertEntityDefInOrg(
  orgId: string,
  entityDefinitionId: string
): Promise<Result<true, BadRequestError>> {
  const resources = await getCachedResources(orgId)
  if (!resources.some((r) => r.entityDefinitionId === entityDefinitionId)) {
    return err(new BadRequestError('Entity definition not found'))
  }
  return ok(true)
}

/**
 * Postgres unique_violation (SQLSTATE 23505) — thrown by the partial unique index.
 * Drizzle wraps the raw `pg` error (which carries `.code`) in a `DrizzleQueryError`
 * and puts the original on `.cause`, so both spots need checking.
 */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } }
  return err?.code === '23505' || err?.cause?.code === '23505'
}

/**
 * Insert a starter v1 for a fresh dashboard, repoint its active pointer, and seed
 * `draftLayout` with the same doc (the row starts already-published: draft ==
 * active, `hasUnpublishedChanges` defaults false).
 */
async function insertInitialVersion(
  tx: Transaction,
  orgId: string,
  dashboardId: string,
  userId: string | null,
  doc: DashboardLayoutDoc
): Promise<void> {
  const versionId = generateId()
  const layout = doc as unknown as Record<string, unknown>
  await tx.insert(schema.DashboardVersion).values({
    id: versionId,
    organizationId: orgId,
    dashboardId,
    versionNumber: 1,
    layout,
    configHash: hashLayoutDoc(doc),
    editorId: userId,
  })
  await tx
    .update(schema.Dashboard)
    .set({ activeVersionId: versionId, draftLayout: layout })
    .where(eq(schema.Dashboard.id, dashboardId))
}

/** Next append position (max + 1) for this org. */
async function nextPosition(tx: Transaction, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`COALESCE(MAX(${schema.Dashboard.position}), 0)` })
    .from(schema.Dashboard)
    .where(and(eq(schema.Dashboard.organizationId, orgId), isNull(schema.Dashboard.archivedAt)))
  return Number(row?.max ?? 0) + 1
}

export type InsertPublishedDashboardInput = {
  name: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  /** Defaults to `false` (shared) — every current caller (user-create, seed) wants org visibility. */
  isPrivate?: boolean
  entityDefinitionId?: string | null
  /** Attributed creator/editor. `null` for a row with no human owner. */
  createdById: string | null
  layout: DashboardLayoutDoc
}

/**
 * Insert a brand-new dashboard that starts already "published": the row, a v1
 * `DashboardVersion` snapshotting `layout`, `activeVersionId` pointed at it,
 * `draftLayout` mirroring the same doc (`hasUnpublishedChanges` defaults false),
 * and the instance-access baseline rows (doc 13 §2 — {@link insertInstanceAccessBaseline})
 * — all in one transaction. The ONE place this v1-publish invariant is written,
 * shared by `createDashboard` (starter doc, user-facing) and the default-dashboard
 * seeder (resolved template doc — `entity-seeder/create-default-dashboards.ts`).
 * Busts `restrictedInstanceIds`/`userCapabilities` AFTER the transaction commits —
 * without this, `dashboard` being `baselineAtCreate: true` means the creator can't
 * see the dashboard they just made (doc 13 §4 caveat).
 *
 * Does NOT validate `layout` or check the entity-def unique constraint — callers
 * own both (a starter doc is valid by construction; the seeder validates against
 * the strict `dashboardLayoutDocSchema` before calling this and pre-checks the
 * link, though a caller wanting the friendly `ConflictError` mapping should still
 * catch `isUniqueViolation` the way `createDashboard` does below).
 */
export async function insertPublishedDashboard(
  db: Database,
  orgId: string,
  input: InsertPublishedDashboardInput
): Promise<string> {
  const dashboardId = generateId()
  await db.transaction(async (tx) => {
    await tx.insert(schema.Dashboard).values({
      id: dashboardId,
      organizationId: orgId,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? undefined,
      entityDefinitionId: input.entityDefinitionId ?? null,
      createdById: input.createdById,
      position: await nextPosition(tx, orgId),
    })
    await insertInitialVersion(tx, orgId, dashboardId, input.createdById, input.layout)
    await insertInstanceAccessBaseline(tx, orgId, dashboardId, {
      isPrivate: input.isPrivate ?? false,
      ownerId: input.createdById,
    })
  })
  await emitResourceAccessInstanceChanged(orgId, baselineGrantees(input.createdById))
  return dashboardId
}

/**
 * Create a dashboard with a starter layout (one empty `Overview` tab): insert
 * the row, insert v1, repoint `activeVersionId` — all in one transaction.
 */
export async function createDashboard(
  db: Database,
  orgId: string,
  userId: string,
  input: CreateDashboardInput
): Promise<Result<DashboardWithLayout, Error>> {
  if (input.entityDefinitionId) {
    const check = await assertEntityDefInOrg(orgId, input.entityDefinitionId)
    if (check.isErr()) return err(check.error)
  }

  const doc = createStarterLayoutDoc()
  let dashboardId: string

  try {
    dashboardId = await insertPublishedDashboard(db, orgId, {
      name: input.name,
      description: input.description ?? null,
      icon: input.icon,
      // Entity dashboards are always org-visible (locked decision 5) — a private
      // one would dead-end other members: they'd see the empty state but hit the
      // unique conflict on create.
      isPrivate: input.entityDefinitionId ? false : (input.isPrivate ?? false),
      entityDefinitionId: input.entityDefinitionId ?? null,
      createdById: userId,
      layout: doc,
    })
  } catch (e) {
    if (isUniqueViolation(e)) {
      return err(new ConflictError('This entity already has a dashboard'))
    }
    throw e
  }

  return getDashboard(db, orgId, { id: dashboardId })
}

export type UpdateDashboardPatch = {
  name?: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  position?: number
  /** Link (a def in this org) / unlink (`null`) this dashboard from an entity def. */
  entityDefinitionId?: string | null
}

/**
 * Update row metadata only — never touches versions. `userId` is used solely as
 * `grantedById` when linking an entity def forces the workspace baseline open
 * (below) — it is NOT an access check (the router already gated `assertEditInstance`).
 */
export async function updateDashboard(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string,
  patch: UpdateDashboardPatch
): Promise<Result<DashboardWithLayout, Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)

  if (patch.entityDefinitionId) {
    const check = await assertEntityDefInOrg(orgId, patch.entityDefinitionId)
    if (check.isErr()) return err(check.error)
  }

  const set: Record<string, unknown> = {}
  if (patch.name !== undefined) set.name = patch.name
  if (patch.description !== undefined) set.description = patch.description
  if (patch.icon !== undefined) set.icon = patch.icon
  if (patch.position !== undefined) set.position = patch.position
  if (patch.entityDefinitionId !== undefined) set.entityDefinitionId = patch.entityDefinitionId
  // Linking forces the workspace baseline open (locked decision 5) — an
  // entity-linked dashboard must be org-visible. Unlinking (`null`) leaves the
  // baseline as-is.
  const linking = Boolean(patch.entityDefinitionId)

  try {
    await db.transaction(async (tx) => {
      if (Object.keys(set).length > 0) {
        await tx.update(schema.Dashboard).set(set).where(eq(schema.Dashboard.id, dashboardId))
      }
      if (linking) {
        await tx
          .insert(schema.ResourceAccess)
          .values({
            organizationId: orgId,
            entityDefinitionId: DASHBOARD_KEY,
            entityInstanceId: dashboardId,
            granteeType: ResourceGranteeType.role,
            granteeId: WORKSPACE_BASELINE_GRANTEE,
            permission: ResourcePermission.view,
            grantedById: userId,
          })
          .onConflictDoUpdate({
            target: [
              schema.ResourceAccess.organizationId,
              schema.ResourceAccess.entityDefinitionId,
              schema.ResourceAccess.entityInstanceId,
              schema.ResourceAccess.granteeType,
              schema.ResourceAccess.granteeId,
            ],
            set: {
              permission: ResourcePermission.view,
              grantedById: userId,
              updatedAt: new Date(),
            },
          })
      }
    })
  } catch (e) {
    if (isUniqueViolation(e)) {
      return err(new ConflictError('This entity already has a dashboard'))
    }
    throw e
  }

  if (linking) {
    await emitResourceAccessInstanceChanged(orgId, [
      { granteeType: ResourceGranteeType.role, granteeId: WORKSPACE_BASELINE_GRANTEE },
    ])
  }

  return getDashboard(db, orgId, { id: dashboardId })
}

/** Soft-delete (`archivedAt`). Caller must have already gated admin access. */
export async function archiveDashboard(
  db: Database,
  orgId: string,
  dashboardId: string
): Promise<Result<{ id: string }, Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)

  await db
    .update(schema.Dashboard)
    .set({ archivedAt: new Date() })
    .where(eq(schema.Dashboard.id, dashboardId))
  return ok({ id: dashboardId })
}

/**
 * Duplicate a dashboard: a new row (`"<name> (Copy)"`, the duplicator as owner)
 * with a single v1 that copies the source's ACTIVE layout doc verbatim, plus
 * fresh instance-access baseline rows (doc 13 §2) — the source's workspace
 * baseline `isPrivate` is copied, and the duplicating user gets an `admin` owner
 * grant. Doc-local ids may repeat across dashboards — they're never reconciled
 * with the server. History is NOT copied.
 */
export async function duplicateDashboard(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string
): Promise<Result<DashboardWithLayout, Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)
  const source = rowResult.value
  if (!source.activeVersionId) return err(new NotFoundError('Dashboard has no active version'))

  const activeVersion = await db.query.DashboardVersion.findFirst({
    where: eq(schema.DashboardVersion.id, source.activeVersionId),
  })
  if (!activeVersion) return err(new NotFoundError('Active dashboard version not found'))

  const docResult = parseLayoutDoc(activeVersion.layout)
  if (docResult.isErr()) return err(docResult.error)
  const doc = docResult.value

  const sourceBaseline = await getWorkspaceBaselinePermission(db, orgId, dashboardId)
  const isPrivate = sourceBaseline === undefined || sourceBaseline === ResourcePermission.none

  const newId = generateId()
  await db.transaction(async (tx) => {
    await tx.insert(schema.Dashboard).values({
      id: newId,
      organizationId: orgId,
      name: `${source.name} (Copy)`,
      description: source.description,
      icon: source.icon,
      // Deliberately NOT copying `entityDefinitionId` (locked decision 11) — the
      // partial unique index allows only one live dashboard per org+def, so the
      // copy always starts unlinked.
      createdById: userId,
      position: await nextPosition(tx, orgId),
    })
    await insertInitialVersion(tx, orgId, newId, userId, doc)
    await insertInstanceAccessBaseline(tx, orgId, newId, { isPrivate, ownerId: userId })
  })
  await emitResourceAccessInstanceChanged(orgId, baselineGrantees(userId))

  return getDashboard(db, orgId, { id: newId })
}
