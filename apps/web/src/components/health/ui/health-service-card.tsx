// apps/web/src/components/health/ui/health-service-card.tsx
'use client'

import type { HealthIndicatorId, HealthStatus } from '@auxx/lib/health/client'
import { Card, CardContent } from '@auxx/ui/components/card'
import { AppWindow, Cog, Database, HardDrive, RotateCw } from 'lucide-react'
import { StatusDot } from './status-dot'

/** Icon mapping for each indicator */
const INDICATOR_ICONS: Record<HealthIndicatorId, React.ComponentType<{ className?: string }>> = {
  database: Database,
  redis: HardDrive,
  worker: Cog,
  jobs: RotateCw,
  app: AppWindow,
}

interface HealthServiceCardProps {
  id: HealthIndicatorId
  label: string
  status: HealthStatus
  onClick: () => void
}

/**
 * Card showing the status of a single service.
 */
export function HealthServiceCard({ id, label, status, onClick }: HealthServiceCardProps) {
  const Icon = INDICATOR_ICONS[id]

  return (
    <Card className='cursor-pointer transition-colors hover:bg-muted/50' onClick={onClick}>
      <CardContent className='flex items-center justify-between p-4'>
        <div className='flex items-center gap-3'>
          <Icon className='h-5 w-5 text-muted-foreground' />
          <span className='font-medium'>{label}</span>
        </div>
        <StatusDot status={status} showLabel />
      </CardContent>
    </Card>
  )
}
