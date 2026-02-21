// apps/web/src/components/health/ui/jobs-details.tsx
'use client'

import { Separator } from '@auxx/ui/components/separator'
import { StatRow } from './stat-row'

interface JobsDetailsProps {
  details: Record<string, any>
}

/**
 * Background jobs detail view — aggregate stats.
 */
export function JobsDetails({ details }: JobsDetailsProps) {
  return (
    <div className='space-y-6'>
      <div>
        <h4 className='text-sm font-medium mb-2'>Overall</h4>
        <StatRow label='Total Jobs' value={details.totalJobs?.toLocaleString() ?? 0} />
        <StatRow label='Completed' value={details.totalCompleted?.toLocaleString() ?? 0} />
        <StatRow label='Failed' value={details.totalFailed?.toLocaleString() ?? 0} />
        <StatRow label='Failure Rate' value={`${details.overallFailureRate ?? 0}%`} />
      </div>

      {details.queues && details.queues.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className='text-sm font-medium mb-2'>Per Queue</h4>
            {details.queues.map((q: any) => (
              <div key={q.queueName} className='mb-3'>
                <div className='font-mono text-xs text-muted-foreground mb-1'>{q.queueName}</div>
                <div className='grid grid-cols-3 gap-2 text-xs'>
                  <div>
                    <span className='text-muted-foreground'>Done: </span>
                    {q.completed?.toLocaleString()}
                  </div>
                  <div>
                    <span className='text-muted-foreground'>Failed: </span>
                    {q.failed?.toLocaleString()}
                  </div>
                  <div>
                    <span className='text-muted-foreground'>Rate: </span>
                    {q.failureRate}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
