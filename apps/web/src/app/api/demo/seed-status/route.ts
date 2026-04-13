// apps/web/src/app/api/demo/seed-status/route.ts

import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/demo/seed-status?jobId=<id>
 *
 * Returns the current state of a demo seed job so the client can poll
 * until seeding completes before redirecting to /app.
 */
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ status: 'unknown' }, { status: 400 })
  }

  const queue = getQueue(Queues.maintenanceQueue)
  const job = await queue.getJob(jobId)

  if (!job) {
    // Job was removed (past retention) or never existed — treat as done
    return NextResponse.json({ status: 'completed' })
  }

  const state = await job.getState()
  return NextResponse.json({ status: state })
}
