// apps/build/src/app/health/route.ts
import { type NextRequest, NextResponse } from 'next/server'

/** Health check endpoint for Docker healthchecks */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  )
}
