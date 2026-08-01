// apps/web/src/app/api/workflows/[workflowId]/files/[fileId]/route.ts

import { database as db, schema } from '@auxx/database'
import { getCapabilities } from '@auxx/lib/permissions'
import { assertWorkflowVersionNotSystemOwned } from '@auxx/lib/workflows'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

interface RouteParams {
  params: Promise<{ workflowId: string; fileId: string }>
}

/**
 * Resolves the parent `WorkflowApp.id` that per-workflow instance access keys on.
 *
 * `[workflowId]` here is a **`Workflow.id` (a version/draft)** — `WorkflowFile.workflowId`
 * FKs `Workflow.id`, not `WorkflowApp.id`, so this route sits in a different id space from
 * its neighbour `/api/workflows/[workflowId]` (which passes its segment straight into
 * `workflow.getById` as a `WorkflowApp.id`). The system-owned guard already joins the
 * parent row, so it hands the app id back rather than us querying twice.
 *
 * Returns a `Response` to send as-is when the caller must be stopped: `403` for a
 * system-owned workflow (Sequences plan §3.4) and `404` for a version that doesn't exist
 * in the caller's org — indistinguishable from another org's version, so version ids stay
 * unprobeable across orgs.
 */
async function resolveWorkflowAppId(
  workflowId: string,
  organizationId: string,
  isSuperAdmin: boolean,
  allowSuperAdminRead: boolean
): Promise<{ workflowAppId: string } | { response: NextResponse }> {
  let workflowAppId: string | undefined
  try {
    workflowAppId = await assertWorkflowVersionNotSystemOwned(db, {
      workflowId,
      organizationId,
      isSuperAdmin,
      allowSuperAdminRead,
    })
  } catch (_error) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (!workflowAppId) {
    return { response: NextResponse.json({ error: 'File not found' }, { status: 404 }) }
  }
  return { workflowAppId }
}

/**
 * Read one file attached to a workflow version.
 *
 * Gated on instance **`view`** of the parent `WorkflowApp`, matching the tRPC ladder's
 * read rung (`workflow.getById` → `assertViewInstance`) and the run-trace SSE route,
 * which exposes comparable run payloads at `view`. `view` already means "you may RUN it"
 * (plan 30 §2), and running a workflow with file inputs implies seeing those inputs.
 *
 * Before this, both handlers scoped on `Workflow.organizationId` alone and read no
 * capabilities, so any authenticated org member could fetch the `File.url` — the direct
 * storage link — for any workflow's attachments, including a workflow they hold an
 * explicit `none` restriction on. #1345 fixed the sibling `/run` route and missed this one.
 *
 * The gate deliberately runs **before** the file read, so an unauthorized caller cannot
 * probe which files exist.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.defaultOrganizationId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId, fileId } = await params
    const organizationId = session.user.defaultOrganizationId

    const resolved = await resolveWorkflowAppId(
      workflowId,
      organizationId,
      (session.user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false,
      true
    )
    if ('response' in resolved) return resolved.response

    const capabilities = await getCapabilities(session.user.id, organizationId)
    if (!capabilities.canViewInstance('workflow', resolved.workflowAppId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get specific workflow file with file details. Authorization already happened above.
    const [workflowFile] = await db
      .select({
        id: schema.WorkflowFile.id,
        fileId: schema.WorkflowFile.fileId,
        workflowId: schema.WorkflowFile.workflowId,
        nodeId: schema.WorkflowFile.nodeId,
        uploadedAt: schema.WorkflowFile.uploadedAt,
        expiresAt: schema.WorkflowFile.expiresAt,
        uploadSource: schema.WorkflowFile.uploadSource,
        metadata: schema.WorkflowFile.metadata,
        // `File` has neither a `mimeType` nor a `url` column. `File.type` is the
        // legacy MIME column; the canonical MIME + URL live on
        // `FileVersion.mimeType` / `StorageLocation.externalUrl`, reachable only by
        // joining `FileVersion` on `fileId` (there is no `File.currentVersionId`).
        // Left as the direct columns because nothing writes `WorkflowFile` — see
        // the note on GET below.
        file: {
          name: schema.File.name,
          mimeType: schema.File.type,
          size: schema.File.size,
        },
      })
      .from(schema.WorkflowFile)
      .innerJoin(schema.File, eq(schema.WorkflowFile.fileId, schema.File.id))
      .innerJoin(schema.Workflow, eq(schema.WorkflowFile.workflowId, schema.Workflow.id))
      .where(
        and(
          eq(schema.WorkflowFile.id, fileId),
          eq(schema.WorkflowFile.workflowId, workflowId),
          eq(schema.Workflow.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!workflowFile) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Check if expired
    if (workflowFile.expiresAt && new Date() > workflowFile.expiresAt) {
      return NextResponse.json({ error: 'File expired' }, { status: 410 })
    }

    return NextResponse.json({
      file: {
        id: workflowFile.id,
        fileId: workflowFile.fileId,
        filename: workflowFile.file.name || 'unnamed',
        mimeType: workflowFile.file.mimeType || 'application/octet-stream',
        size: workflowFile.file.size,
        nodeId: workflowFile.nodeId,
        uploadedAt: workflowFile.uploadedAt.toISOString(),
        expiresAt: workflowFile.expiresAt?.toISOString(),
        uploadSource: workflowFile.uploadSource,
        metadata: workflowFile.metadata,
      },
    })
  } catch (error) {
    console.error('Failed to get workflow file:', error)
    return NextResponse.json({ error: 'Failed to get file' }, { status: 500 })
  }
}

/**
 * Detach (hard-delete) one file from a workflow version.
 *
 * Gated on instance **`edit`**, NOT `admin`. The ladder's `admin` rung is reserved for
 * destroying the workflow itself (`workflow.delete` → `assertAdminInstance`, "the workflow
 * and every version") and for its settings/sharing surface (`ADMIN_ONLY_UPDATE_FIELDS`).
 * Removing one attached file is an ordinary authoring mutation of the version's content —
 * the same class as saving the draft graph, which `workflow.update` gates at
 * `assertEditInstance`. It is also symmetric with the surface that CREATES these rows:
 * `/api/workflows/[workflowId]/run` accepts file inputs at instance `edit`, so requiring
 * `admin` to clean them up would strand ordinary authors with their own uploads.
 *
 * Deliberately NOT `view`: `view` confers running, not mutating.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.defaultOrganizationId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId, fileId } = await params
    const organizationId = session.user.defaultOrganizationId

    // Write path — super admins get no read-only bypass here.
    const resolved = await resolveWorkflowAppId(
      workflowId,
      organizationId,
      (session.user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false,
      false
    )
    if ('response' in resolved) return resolved.response

    const capabilities = await getCapabilities(session.user.id, organizationId)
    if (!capabilities.canEditInstance('workflow', resolved.workflowAppId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete workflow file (this will cascade to delete the File record too if no other references)
    // First verify the file exists and belongs to the organization
    const [existingFile] = await db
      .select({ id: schema.WorkflowFile.id })
      .from(schema.WorkflowFile)
      .innerJoin(schema.Workflow, eq(schema.WorkflowFile.workflowId, schema.Workflow.id))
      .where(
        and(
          eq(schema.WorkflowFile.id, fileId),
          eq(schema.WorkflowFile.workflowId, workflowId),
          eq(schema.Workflow.organizationId, organizationId)
        )
      )
      .limit(1)

    if (existingFile) {
      await db.delete(schema.WorkflowFile).where(eq(schema.WorkflowFile.id, fileId))
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete workflow file:', error)
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
}
