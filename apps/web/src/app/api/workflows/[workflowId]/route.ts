// apps/web/src/app/api/workflows/[workflowId]/route.ts

import { TRPCError } from '@trpc/server'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { appRouter } from '~/server/api/root'
import { createTRPCContext } from '~/server/api/trpc'

interface RouteParams {
  params: Promise<{ workflowId: string }>
}

/**
 * GET /api/workflows/[workflowId] - Get a specific workflow
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId } = await params

    // Create tRPC context
    const ctx = await createTRPCContext({ headers: req.headers })

    // Call tRPC procedure
    const caller = appRouter.createCaller(ctx)
    const result = await caller.workflow.getById({ id: workflowId })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching workflow:', error)

    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'UNAUTHORIZED' ? 401 : 500 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows/[workflowId] - Update a workflow
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId } = await params
    const body = await req.json()

    // Create tRPC context
    const ctx = await createTRPCContext({ headers: req.headers })

    // Call tRPC procedure
    const caller = appRouter.createCaller(ctx)
    const result = await caller.workflow.update({ id: workflowId, ...body })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating workflow:', error)

    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'UNAUTHORIZED' ? 401 : 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/workflows/[workflowId] - Update a workflow (for beacon API support)
 * This is identical to PUT but supports navigator.sendBeacon which only sends POST requests
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId } = await params
    const body = await req.json()

    // Create tRPC context
    const ctx = await createTRPCContext({ headers: req.headers })

    // Call tRPC procedure
    const caller = appRouter.createCaller(ctx)
    const result = await caller.workflow.update({ id: workflowId, ...body })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating workflow:', error)

    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'UNAUTHORIZED' ? 401 : 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/workflows/[workflowId] - Delete a workflow
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId } = await params

    // Create tRPC context
    const ctx = await createTRPCContext({ headers: req.headers })

    // Call tRPC procedure
    const caller = appRouter.createCaller(ctx)
    const result = await caller.workflow.delete({ id: workflowId })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error deleting workflow:', error)

    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'UNAUTHORIZED' ? 401 : 500 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
