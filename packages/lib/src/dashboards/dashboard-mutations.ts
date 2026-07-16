// packages/lib/src/dashboards/dashboard-mutations.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedResources } from '../cache'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors'
import { canEditDashboard } from './access'
import {
  createStarterLayoutDoc,
  type DashboardLayoutDoc,
  type DashboardVisibility,
  type DashboardWithLayout,
} from './client'
import { hashLayoutDoc } from './config-hash'
import { getDashboard, loadDashboardRow, parseLayoutDoc } from './dashboard-queries'

/**
 * Write paths for dashboard identity/access + lifecycle. Version content is
 * owned by `version-mutations.ts`; the only version write here is the v1 insert
 * that every create/duplicate performs in the same transaction as the row. Never
 * touches an existing version. Functional Drizzle, `neverthrow` results.
 */

export type CreateDashboardInput = {
  name: string
  description?: string | null
  icon?: { iconId: string; color: string }
  visibility?: DashboardVisibility
  /** Links the new dashboard as THE dashboard for this entity def (see `getDashboard`). */
  entityDefinitionId?: string
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
  /** Defaults to `'org'` — every current caller (user-create, seed) wants org visibility. */
  visibility?: DashboardVisibility
  entityDefinitionId?: string | null
  /** Attributed creator/editor. `null` for a row with no human owner. */
  createdById: string | null
  layout: DashboardLayoutDoc
}

/**
 * Insert a brand-new dashboard that starts already "published": the row, a v1
 * `DashboardVersion` snapshotting `layout`, `activeVersionId` pointed at it, and
 * `draftLayout` mirroring the same doc (`hasUnpublishedChanges` defaults false) —
 * all in one transaction. The ONE place this v1-publish invariant is written,
 * shared by `createDashboard` (starter doc, user-facing) and the default-dashboard
 * seeder (resolved template doc — `entity-seeder/create-default-dashboards.ts`).
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
      visibility: input.visibility ?? 'org',
      entityDefinitionId: input.entityDefinitionId ?? null,
      createdById: input.createdById,
      position: await nextPosition(tx, orgId),
    })
    await insertInitialVersion(tx, orgId, dashboardId, input.createdById, input.layout)
  })
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
      visibility: input.entityDefinitionId ? 'org' : (input.visibility ?? 'org'),
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

  return getDashboard(db, orgId, userId, { id: dashboardId })
}

export type UpdateDashboardPatch = {
  name?: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  visibility?: DashboardVisibility
  position?: number
  /** Link (a def in this org) / unlink (`null`) this dashboard from an entity def. */
  entityDefinitionId?: string | null
}

/** Update row metadata only — never touches versions. */
export async function updateDashboard(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string,
  patch: UpdateDashboardPatch
): Promise<Result<DashboardWithLayout, Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)
  if (!canEditDashboard(rowResult.value, userId)) return err(new ForbiddenError('Not allowed'))

  if (patch.entityDefinitionId) {
    const check = await assertEntityDefInOrg(orgId, patch.entityDefinitionId)
    if (check.isErr()) return err(check.error)
  }

  const set: Record<string, unknown> = {}
  if (patch.name !== undefined) set.name = patch.name
  if (patch.description !== undefined) set.description = patch.description
  if (patch.icon !== undefined) set.icon = patch.icon
  if (patch.visibility !== undefined) set.visibility = patch.visibility
  if (patch.position !== undefined) set.position = patch.position
  if (patch.entityDefinitionId !== undefined) {
    set.entityDefinitionId = patch.entityDefinitionId
    // Linking forces org visibility (locked decision 5); unlinking (`null`) leaves
    // visibility as-is.
    if (patch.entityDefinitionId) set.visibility = 'org'
  }

  if (Object.keys(set).length > 0) {
    try {
      await db.update(schema.Dashboard).set(set).where(eq(schema.Dashboard.id, dashboardId))
    } catch (e) {
      if (isUniqueViolation(e)) {
        return err(new ConflictError('This entity already has a dashboard'))
      }
      throw e
    }
  }

  return getDashboard(db, orgId, userId, { id: dashboardId })
}

/** Soft-delete (`archivedAt`). Requires edit access. */
export async function archiveDashboard(
  db: Database,
  orgId: string,
  userId: string,
  dashboardId: string
): Promise<Result<{ id: string }, Error>> {
  const rowResult = await loadDashboardRow(db, orgId, dashboardId)
  if (rowResult.isErr()) return err(rowResult.error)
  if (!canEditDashboard(rowResult.value, userId)) return err(new ForbiddenError('Not allowed'))

  await db
    .update(schema.Dashboard)
    .set({ archivedAt: new Date() })
    .where(eq(schema.Dashboard.id, dashboardId))
  return ok({ id: dashboardId })
}

/**
 * Duplicate a dashboard: a new row (`"<name> (Copy)"`, the duplicator as owner,
 * visibility copied) with a single v1 that copies the source's ACTIVE layout doc
 * verbatim. Doc-local ids may repeat across dashboards — they're never
 * reconciled with the server. History is NOT copied.
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
  if (!canEditDashboard(source, userId)) return err(new ForbiddenError('Not allowed'))
  if (!source.activeVersionId) return err(new NotFoundError('Dashboard has no active version'))

  const activeVersion = await db.query.DashboardVersion.findFirst({
    where: eq(schema.DashboardVersion.id, source.activeVersionId),
  })
  if (!activeVersion) return err(new NotFoundError('Active dashboard version not found'))

  const docResult = parseLayoutDoc(activeVersion.layout)
  if (docResult.isErr()) return err(docResult.error)
  const doc = docResult.value

  const newId = generateId()
  await db.transaction(async (tx) => {
    await tx.insert(schema.Dashboard).values({
      id: newId,
      organizationId: orgId,
      name: `${source.name} (Copy)`,
      description: source.description,
      icon: source.icon,
      visibility: source.visibility,
      // Deliberately NOT copying `entityDefinitionId` (locked decision 11) — the
      // partial unique index allows only one live dashboard per org+def, so the
      // copy always starts unlinked.
      createdById: userId,
      position: await nextPosition(tx, orgId),
    })
    await insertInitialVersion(tx, orgId, newId, userId, doc)
  })

  return getDashboard(db, orgId, userId, { id: newId })
}
