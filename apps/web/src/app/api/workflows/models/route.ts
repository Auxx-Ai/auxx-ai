// apps/web/src/app/api/workflows/models/route.ts

import { TRPCError } from '@trpc/server'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { appRouter } from '~/server/api/root'
import { createTRPCContext } from '~/server/api/trpc'

/**
 * GET /api/workflows/models - Get unified model data including defaults
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse query parameters
    const searchParams = req.nextUrl.searchParams
    const includeDefaults = searchParams.get('includeDefaults') !== 'false' // Default to true

    // Create tRPC context
    const ctx = await createTRPCContext({ headers: req.headers })

    // Call tRPC procedure
    const caller = appRouter.createCaller(ctx)
    const result = await caller.aiIntegration.getUnifiedModelData({ includeDefaults })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching unified model data:', error)

    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'UNAUTHORIZED' ? 401 : 500 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
