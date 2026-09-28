// app/(protected)/app/settings/plans/_components/usage-section.tsx
'use client'

import { Progress } from '@auxx/ui/components/progress'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { Gauge } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import { api } from '~/trpc/react'

/** Plan usage meters on the billing page. Records is the only org-total metric so far. */
export function UsageSection() {
  const { data: records, isLoading } = api.usage.getRecords.useQuery()

  return (
    <SettingsSection
      className='space-y-3'
      icon={Gauge}
      title='Usage'
      description='How much of your plan your organization is using'>
      <div className='rounded-2xl border p-4'>
        {isLoading || !records ? (
          <div className='space-y-2'>
            <Skeleton className='h-4 w-40' />
            <Skeleton className='h-2 w-full' />
          </div>
        ) : (
          <UsageMeter
            label='Records'
            count={records.count}
            soft={records.soft}
            hard={records.hard}
            unit='records'
          />
        )}
      </div>
    </SettingsSection>
  )
}

function UsageMeter({
  label,
  count,
  soft,
  hard,
  unit,
}: {
  label: string
  count: number
  soft: number | null
  hard: number | null
  unit: string
}) {
  const hardReached = hard !== null && count >= hard
  const softReached = soft !== null && count >= soft
  const percent = hard ? Math.min(100, (count / hard) * 100) : 0
  const softPercent = hard && soft !== null ? Math.min(100, (soft / hard) * 100) : null

  return (
    <div className='space-y-2'>
      <div className='flex items-baseline justify-between gap-2 text-sm'>
        <span className='font-medium'>{label}</span>
        <span className='text-muted-foreground tabular-nums'>
          {hard === null
            ? `${count.toLocaleString()} ${unit} · Unlimited`
            : `${count.toLocaleString()} of ${hard.toLocaleString()} ${unit}`}
        </span>
      </div>
      {hard !== null && (
        <div className='relative'>
          <Progress
            value={percent}
            indicatorClassName={cn(
              hardReached ? 'bg-destructive' : softReached ? 'bg-amber-500' : undefined
            )}
          />
          {softPercent !== null && (
            <div
              className='absolute -top-0.5 h-3 w-px bg-amber-500'
              style={{ left: `${softPercent}%` }}
              title={`Warning at ${soft?.toLocaleString()} ${unit}`}
            />
          )}
        </div>
      )}
      {hardReached ? (
        <p className='text-sm text-destructive'>
          Records limit reached — upgrade to add more. New imports and records are blocked.
        </p>
      ) : softReached ? (
        <p className='text-sm text-amber-600 dark:text-amber-400'>
          You are close to your plan&apos;s records limit.
        </p>
      ) : null}
    </div>
  )
}
