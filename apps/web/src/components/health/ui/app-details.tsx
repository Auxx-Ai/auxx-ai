// apps/web/src/components/health/ui/app-details.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
import { StatRow } from './stat-row'

interface AppDetailsProps {
  details: Record<string, any>
}

/**
 * Application health detail view.
 */
export function AppDetails({ details }: AppDetailsProps) {
  const { system, overview } = details

  return (
    <>
      <Section title='Runtime' description='Node.js version and environment' initialOpen>
        <StatRow label='Node.js' value={system?.nodeVersion ?? 'Unknown'} />
        <StatRow label='Environment' value={system?.environment ?? 'Unknown'} />
      </Section>

      <Section title='Overview' description='High-level application statistics' initialOpen>
        <StatRow label='Organizations' value={overview?.totalOrganizations ?? 0} />
      </Section>
    </>
  )
}
