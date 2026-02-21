// apps/web/src/components/health/ui/redis-details.tsx
'use client'

import { Separator } from '@auxx/ui/components/separator'
import { StatRow } from './stat-row'

interface RedisDetailsProps {
  details: Record<string, any>
}

/**
 * Redis indicator detail view.
 */
export function RedisDetails({ details }: RedisDetailsProps) {
  const { system, memory, connections, performance, replication } = details

  return (
    <div className='space-y-6'>
      <div>
        <h4 className='text-sm font-medium mb-2'>System</h4>
        <StatRow label='Version' value={system?.version ?? 'Unknown'} />
        <StatRow label='Uptime' value={system?.uptime ?? 'Unknown'} />
      </div>

      {memory && (
        <>
          <Separator />
          <div>
            <h4 className='text-sm font-medium mb-2'>Memory</h4>
            <StatRow label='Used' value={memory.used ?? 'Unknown'} />
            <StatRow label='Peak' value={memory.peak ?? 'Unknown'} />
            <StatRow label='Fragmentation' value={memory.fragmentation ?? 0} />
          </div>
        </>
      )}

      {connections && (
        <>
          <Separator />
          <div>
            <h4 className='text-sm font-medium mb-2'>Connections</h4>
            <StatRow label='Current' value={connections.current ?? 0} />
            <StatRow label='Total' value={connections.total ?? 0} />
            <StatRow label='Rejected' value={connections.rejected ?? 0} />
          </div>
        </>
      )}

      {performance && (
        <>
          <Separator />
          <div>
            <h4 className='text-sm font-medium mb-2'>Performance</h4>
            <StatRow label='Ops/sec' value={performance.opsPerSecond ?? 0} />
            <StatRow label='Hit Rate' value={performance.hitRate ?? '0%'} />
            <StatRow label='Evicted Keys' value={performance.evictedKeys ?? 0} />
            <StatRow label='Expired Keys' value={performance.expiredKeys ?? 0} />
          </div>
        </>
      )}

      {replication && (
        <>
          <Separator />
          <div>
            <h4 className='text-sm font-medium mb-2'>Replication</h4>
            <StatRow label='Role' value={replication.role ?? 'unknown'} />
            <StatRow label='Connected Replicas' value={replication.connectedSlaves ?? 0} />
          </div>
        </>
      )}
    </div>
  )
}
