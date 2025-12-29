// apps/web/src/app/api/workflows/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { appRouter } from '~/server/api/root'
import { createTRPCContext } from '~/server/api/trpc'
import { TRPCError } from '@trpc/server'
import { headers } from 'next/headers'
import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
/**
 * GET /api/workflows - Get all workflows
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse query parameters
    const searchParams = req.nextUrl.searchParams
    const triggerTypeParam = searchParams.get('triggerType')
    const input = {
      enabled: searchParams.get('enabled') ? searchParams.get('enabled') === 'true' : undefined,
      triggerType:
        triggerTypeParam &&
        Object.values(WorkflowTriggerType).includes(triggerTypeParam as WorkflowTriggerType)
          ? (triggerTypeParam as WorkflowTriggerType)
          : undefined,
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    }

    // Create tRPC context
    const ctx = await createTRPCContext({ headers: req.headers })

    // Call tRPC procedure
    const caller = appRouter.createCaller(ctx)
    const result = await caller.workflow.getAll(input)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching workflows:', error)

    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'UNAUTHORIZED' ? 401 : 500 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/workflows - Create a new workflow
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    // Create tRPC context
    const ctx = await createTRPCContext({ headers: req.headers })

    // Call tRPC procedure
    const caller = appRouter.createCaller(ctx)
    const result = await caller.workflow.create(body)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error creating workflow:', error)

    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'UNAUTHORIZED' ? 401 : 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
