// apps/web/src/components/health/ui/app-details.tsx
'use client'

import { Separator } from '@auxx/ui/components/separator'
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
    <div className='space-y-6'>
      <div>
        <h4 className='text-sm font-medium mb-2'>Runtime</h4>
        <StatRow label='Node.js' value={system?.nodeVersion ?? 'Unknown'} />
        <StatRow label='Environment' value={system?.environment ?? 'Unknown'} />
      </div>

      <Separator />

      <div>
        <h4 className='text-sm font-medium mb-2'>Overview</h4>
        <StatRow label='Organizations' value={overview?.totalOrganizations ?? 0} />
      </div>
    </div>
  )
}
