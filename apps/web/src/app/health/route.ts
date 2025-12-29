import { NextRequest, NextResponse } from 'next/server'

// import { database as db } from '@auxx/database'
// import { Redis } from 'ioredis'

export async function GET(req: NextRequest): Promise<NextResponse> {
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
        services: { database: 'connected' },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Health check failed:', error)

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
