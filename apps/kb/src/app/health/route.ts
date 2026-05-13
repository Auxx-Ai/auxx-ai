// apps/kb/src/app/health/route.ts
import { NextResponse } from 'next/server'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || 'dev',
      sha: process.env.GIT_SHA?.slice(0, 7) || 'local',
      buildTime: process.env.BUILD_TIME || null,
      app: 'kb',
    },
    { status: 200 }
  )
}
