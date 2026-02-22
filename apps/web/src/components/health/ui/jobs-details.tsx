// apps/web/src/components/health/ui/jobs-details.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
import { StatRow } from './stat-row'

interface JobsDetailsProps {
  details: Record<string, any>
}

/**
 * Background jobs detail view — aggregate stats.
 */
export function JobsDetails({ details }: JobsDetailsProps) {
  return (
    <>
      <Section title='Overall' description='Aggregate job completion and failure stats' initialOpen>
        <StatRow label='Total Jobs' value={details.totalJobs?.toLocaleString() ?? 0} />
        <StatRow label='Completed' value={details.totalCompleted?.toLocaleString() ?? 0} />
        <StatRow label='Failed' value={details.totalFailed?.toLocaleString() ?? 0} />
        <StatRow label='Failure Rate' value={`${details.overallFailureRate ?? 0}%`} />
      </Section>

      {details.queues && details.queues.length > 0 && (
        <Section title='Per Queue' description='Breakdown of jobs by individual queue' initialOpen>
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
        </Section>
      )}
    </>
  )
}
