// packages/lib/src/workflows/workflow-app-access-guard.ts
// Lockdown for system-owned WorkflowApp rows (Sequences plan §3.4/§21.4 — Phase 0).
// A sequence compiles to a hidden `WorkflowApp` marked via `ownerType`/`ownerId`.
// Every org-facing list/get/mutate surface must stay blind to (or forbidden from)
// these rows; super admins may still *read* them for debugging via
// `allowSuperAdminRead`, never mutate them through this guard.

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ForbiddenError } from '../errors'

const SYSTEM_OWNED_MESSAGE =
  'This workflow is managed by the system and cannot be accessed directly.'

export interface WorkflowAppAccessOptions {
  /** `ctx.session.isSuperAdmin` */
  isSuperAdmin?: boolean
  /** Set true on read-only surfaces to let super admins through for debugging. */
  allowSuperAdminRead?: boolean
}

/**
 * Throws {@link ForbiddenError} when the given `WorkflowApp` is system-owned
 * (`ownerType IS NOT NULL`) and the caller isn't an allowed super-admin read.
 * No-ops (including when the row doesn't exist) so the caller's own lookup
 * still surfaces its normal NOT_FOUND — this guard only ever narrows access.
 */
export async function assertWorkflowAppNotSystemOwned(
  db: Database,
  params: {
    workflowAppId: string
    organizationId: string
  } & WorkflowAppAccessOptions
): Promise<void> {
  const [row] = await db
    .select({ ownerType: schema.WorkflowApp.ownerType })
    .from(schema.WorkflowApp)
    .where(
      and(
        eq(schema.WorkflowApp.id, params.workflowAppId),
        eq(schema.WorkflowApp.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (!row?.ownerType) return
  if (params.allowSuperAdminRead && params.isSuperAdmin) return
  throw new ForbiddenError(SYSTEM_OWNED_MESSAGE)
}

/**
 * Same guard, resolved from a `Workflow.id` (a specific version/draft) —
 * the workflow-run REST route (`/api/workflows/[workflowId]/run`) addresses
 * a version directly rather than its parent `WorkflowApp`.
 */
export async function assertWorkflowVersionNotSystemOwned(
  db: Database,
  params: {
    workflowId: string
    organizationId: string
  } & WorkflowAppAccessOptions
): Promise<void> {
  const [row] = await db
    .select({ ownerType: schema.WorkflowApp.ownerType })
    .from(schema.Workflow)
    .innerJoin(schema.WorkflowApp, eq(schema.WorkflowApp.id, schema.Workflow.workflowAppId))
    .where(
      and(
        eq(schema.Workflow.id, params.workflowId),
        eq(schema.Workflow.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (!row?.ownerType) return
  if (params.allowSuperAdminRead && params.isSuperAdmin) return
  throw new ForbiddenError(SYSTEM_OWNED_MESSAGE)
}

/**
 * Same guard, resolved from a `WorkflowRun.id` — the stop/get/list-run
 * surfaces address runs directly, not their parent app.
 */
export async function assertWorkflowRunNotSystemOwned(
  db: Database,
  params: {
    runId: string
    organizationId: string
  } & WorkflowAppAccessOptions
): Promise<void> {
  const [row] = await db
    .select({ ownerType: schema.WorkflowApp.ownerType })
    .from(schema.WorkflowRun)
    .innerJoin(schema.WorkflowApp, eq(schema.WorkflowApp.id, schema.WorkflowRun.workflowAppId))
    .where(
      and(
        eq(schema.WorkflowRun.id, params.runId),
        eq(schema.WorkflowRun.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (!row?.ownerType) return
  if (params.allowSuperAdminRead && params.isSuperAdmin) return
  throw new ForbiddenError(SYSTEM_OWNED_MESSAGE)
}
