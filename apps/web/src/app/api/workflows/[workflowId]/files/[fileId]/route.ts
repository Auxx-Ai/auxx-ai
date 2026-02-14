// apps/web/src/app/api/workflows/[workflowId]/files/[fileId]/route.ts

import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

interface RouteParams {
  params: Promise<{ workflowId: string; fileId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.defaultOrganizationId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId, fileId } = await params
    const organizationId = session.user.defaultOrganizationId

    // Get specific workflow file with file details
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
        file: {
          name: schema.File.name,
          mimeType: schema.File.mimeType,
          size: schema.File.size,
          url: schema.File.url,
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
        url: workflowFile.file.url,
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

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.defaultOrganizationId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId, fileId } = await params
    const organizationId = session.user.defaultOrganizationId

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
