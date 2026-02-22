// apps/web/src/components/health/ui/redis-details.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
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
    <>
      <Section title='System' description='Redis engine version and uptime' initialOpen>
        <StatRow label='Version' value={system?.version ?? 'Unknown'} />
        <StatRow label='Uptime' value={system?.uptime ?? 'Unknown'} />
      </Section>

      {memory && (
        <Section
          title='Memory'
          description='RAM usage, peak allocation, and fragmentation'
          initialOpen>
          <StatRow label='Used' value={memory.used ?? 'Unknown'} />
          <StatRow label='Peak' value={memory.peak ?? 'Unknown'} />
          <StatRow label='Fragmentation' value={memory.fragmentation ?? 0} />
        </Section>
      )}

      {connections && (
        <Section
          title='Connections'
          description='Current, total, and rejected client connections'
          initialOpen>
          <StatRow label='Current' value={connections.current ?? 0} />
          <StatRow label='Total' value={connections.total ?? 0} />
          <StatRow label='Rejected' value={connections.rejected ?? 0} />
        </Section>
      )}

      {performance && (
        <Section
          title='Performance'
          description='Throughput, cache hit rate, and key eviction stats'
          initialOpen>
          <StatRow label='Ops/sec' value={performance.opsPerSecond ?? 0} />
          <StatRow label='Hit Rate' value={performance.hitRate ?? '0%'} />
          <StatRow label='Evicted Keys' value={performance.evictedKeys ?? 0} />
          <StatRow label='Expired Keys' value={performance.expiredKeys ?? 0} />
        </Section>
      )}

      {replication && (
        <Section
          title='Replication'
          description='Replica role and connected slave count'
          initialOpen>
          <StatRow label='Role' value={replication.role ?? 'unknown'} />
          <StatRow label='Connected Replicas' value={replication.connectedSlaves ?? 0} />
        </Section>
      )}
    </>
  )
}
