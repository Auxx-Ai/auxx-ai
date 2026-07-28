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
 *
 * @returns the parent `WorkflowApp.id`, or `undefined` when no such version
 * exists in the org. Per-workflow instance access (plan 30) keys on the PARENT
 * app id, so callers holding only a version id need it — returning it here
 * saves the second lookup, since this guard already joins the parent row.
 */
export async function assertWorkflowVersionNotSystemOwned(
  db: Database,
  params: {
    workflowId: string
    organizationId: string
  } & WorkflowAppAccessOptions
): Promise<string | undefined> {
  const [row] = await db
    .select({ ownerType: schema.WorkflowApp.ownerType, workflowAppId: schema.WorkflowApp.id })
    .from(schema.Workflow)
    .innerJoin(schema.WorkflowApp, eq(schema.WorkflowApp.id, schema.Workflow.workflowAppId))
    .where(
      and(
        eq(schema.Workflow.id, params.workflowId),
        eq(schema.Workflow.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (!row?.ownerType) return row?.workflowAppId
  if (params.allowSuperAdminRead && params.isSuperAdmin) return row.workflowAppId
  throw new ForbiddenError(SYSTEM_OWNED_MESSAGE)
}

/**
 * The `User.id` that started a workflow run, or `null` when it has no owner.
 *
 * NOT a guard — pure ownership data for the "a `view` holder may stop a run
 * THEY started" rule (plan 30, user decision 2026-07-27). Deliberately separate
 * from {@link assertWorkflowRunNotSystemOwned} so that guard's contract and its
 * three existing call sites stay unchanged; the stop paths pay one extra read
 * only when the caller lacks instance `edit`.
 *
 * `null` covers three cases, all of which must DENY a `view`-only caller:
 *  - the run does not exist (callers resolve it through the guard first, so this
 *    is unreachable there),
 *  - `createdBy` was nulled by `ON DELETE SET NULL` when the creator's `User`
 *    row went away,
 *  - the column was never written.
 *
 * Headless runs are NOT `null`: every programmatic start resolves
 * `SystemUserService.getSystemUserForActions(orgId)` and writes that system
 * `User.id`, so an id comparison against the caller already excludes them — no
 * `'system'` sentinel to special-case.
 */
export async function getWorkflowRunCreatorId(
  db: Database,
  params: { runId: string; organizationId: string }
): Promise<string | null> {
  const [row] = await db
    .select({ createdBy: schema.WorkflowRun.createdBy })
    .from(schema.WorkflowRun)
    .where(
      and(
        eq(schema.WorkflowRun.id, params.runId),
        eq(schema.WorkflowRun.organizationId, params.organizationId)
      )
    )
    .limit(1)

  return row?.createdBy ?? null
}

/**
 * Same guard, resolved from a `WorkflowRun.id` — the stop/get/list-run
 * surfaces address runs directly, not their parent app.
 *
 * @returns the parent `WorkflowApp.id`, or `undefined` when no such run exists
 * in the org (see {@link assertWorkflowVersionNotSystemOwned} for why).
 */
export async function assertWorkflowRunNotSystemOwned(
  db: Database,
  params: {
    runId: string
    organizationId: string
  } & WorkflowAppAccessOptions
): Promise<string | undefined> {
  const [row] = await db
    .select({ ownerType: schema.WorkflowApp.ownerType, workflowAppId: schema.WorkflowApp.id })
    .from(schema.WorkflowRun)
    .innerJoin(schema.WorkflowApp, eq(schema.WorkflowApp.id, schema.WorkflowRun.workflowAppId))
    .where(
      and(
        eq(schema.WorkflowRun.id, params.runId),
        eq(schema.WorkflowRun.organizationId, params.organizationId)
      )
    )
    .limit(1)

  if (!row?.ownerType) return row?.workflowAppId
  if (params.allowSuperAdminRead && params.isSuperAdmin) return row.workflowAppId
  throw new ForbiddenError(SYSTEM_OWNED_MESSAGE)
}
