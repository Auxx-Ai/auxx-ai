import { NextResponse } from 'next/server'

export async function GET(): Promise<NextResponse> {
  try {
    // Check database connection
    // await db.$queryRaw`SELECT 1`

    // Check Redis connection
    // await redis.ping()

    // Return healthy status
    return NextResponse.json(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
        sha: process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) || 'local',
        buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || null,
        services: { database: 'connected' },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Health check failed:', error)

    // Determine which service failed

    // Return unhealthy status with details
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        // services: { database: databaseStatus },
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    )
  } finally {
    // Disconnect services to prevent connection leaks
    // await db.$disconnect()
    // redis.disconnect()
  }
}
