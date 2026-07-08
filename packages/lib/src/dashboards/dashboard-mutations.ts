// packages/lib/src/dashboards/dashboard-mutations.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { ForbiddenError, NotFoundError } from '../errors'
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
}

/** Insert a starter v1 for a fresh dashboard and repoint its active pointer. */
async function insertInitialVersion(
  tx: Transaction,
  orgId: string,
  dashboardId: string,
  userId: string,
  doc: DashboardLayoutDoc
): Promise<void> {
  const versionId = generateId()
  await tx.insert(schema.DashboardVersion).values({
    id: versionId,
    organizationId: orgId,
    dashboardId,
    versionNumber: 1,
    layout: doc as unknown as Record<string, unknown>,
    configHash: hashLayoutDoc(doc),
    editorId: userId,
  })
  await tx
    .update(schema.Dashboard)
    .set({ activeVersionId: versionId })
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
  const dashboardId = generateId()
  const doc = createStarterLayoutDoc()

  await db.transaction(async (tx) => {
    await tx.insert(schema.Dashboard).values({
      id: dashboardId,
      organizationId: orgId,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon,
      visibility: input.visibility ?? 'org',
      createdById: userId,
      position: await nextPosition(tx, orgId),
    })
    await insertInitialVersion(tx, orgId, dashboardId, userId, doc)
  })

  return getDashboard(db, orgId, userId, dashboardId)
}

export type UpdateDashboardPatch = {
  name?: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  visibility?: DashboardVisibility
  position?: number
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

  const set: Record<string, unknown> = {}
  if (patch.name !== undefined) set.name = patch.name
  if (patch.description !== undefined) set.description = patch.description
  if (patch.icon !== undefined) set.icon = patch.icon
  if (patch.visibility !== undefined) set.visibility = patch.visibility
  if (patch.position !== undefined) set.position = patch.position

  if (Object.keys(set).length > 0) {
    await db.update(schema.Dashboard).set(set).where(eq(schema.Dashboard.id, dashboardId))
  }

  return getDashboard(db, orgId, userId, dashboardId)
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
      createdById: userId,
      position: await nextPosition(tx, orgId),
    })
    await insertInitialVersion(tx, orgId, newId, userId, doc)
  })

  return getDashboard(db, orgId, userId, newId)
}
