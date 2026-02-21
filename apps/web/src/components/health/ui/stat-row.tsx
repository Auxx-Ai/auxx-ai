// apps/web/src/components/health/ui/stat-row.tsx
'use client'

interface StatRowProps {
  label: string
  value: string | number
  muted?: boolean
}

/**
 * Simple label-value row for displaying stats.
 */
export function StatRow({ label, value, muted }: StatRowProps) {
  return (
    <div className='flex items-center justify-between py-1.5'>
      <span className='text-sm text-muted-foreground'>{label}</span>
      <span className={`text-sm font-mono ${muted ? 'text-muted-foreground' : ''}`}>{value}</span>
    </div>
  )
}
