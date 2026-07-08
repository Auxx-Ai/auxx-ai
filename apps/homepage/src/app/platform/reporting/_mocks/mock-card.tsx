// apps/homepage/src/app/platform/reporting/_mocks/mock-card.tsx

import { cn } from '~/lib/utils'

/**
 * Fixed 4-slot categorical palette for every reporting mock (sky → violet →
 * amber → emerald), stepped per theme so each slot clears contrast + CVD
 * checks on both surfaces. Applied as local CSS vars because the homepage
 * themes via `data-theme='dark'`, which the shadcn ChartStyle `.dark`
 * selector never matches. Assign slots in order, never cycled.
 */
export const CHART_VARS_CLASS =
  '[--report-c1:var(--color-sky-500)] [--report-c2:var(--color-violet-500)] [--report-c3:var(--color-amber-500)] [--report-c4:var(--color-emerald-500)] [--report-rest:var(--color-zinc-200)] dark:[--report-c1:var(--color-sky-600)] dark:[--report-c3:var(--color-amber-600)] dark:[--report-c4:var(--color-emerald-600)] dark:[--report-rest:var(--color-zinc-700)]'

interface MockCardProps {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  /** Layered before/after border chrome (hero tiles). Off = flat widget card. */
  layered?: boolean
  className?: string
  contentClassName?: string
  children: React.ReactNode
}

/**
 * Card chrome for the reporting chart mocks. `layered` reproduces the stacked
 * border treatment from `visualization-illustration.tsx`; the flat variant is
 * a plain dashboard-widget card for grids.
 */
export function MockCard({
  title,
  subtitle,
  layered = false,
  className,
  contentClassName,
  children,
}: MockCardProps) {
  const body = (
    <div
      className={cn(
        'bg-illustration ring-border-illustration relative z-10 rounded-2xl border border-transparent p-5 shadow-xl shadow-black/10 ring-1',
        !layered && 'rounded-xl p-4 shadow-sm',
        CHART_VARS_CLASS,
        contentClassName
      )}>
      {title != null && <div className='text-foreground text-sm font-medium'>{title}</div>}
      {subtitle != null && <div className='text-muted-foreground mt-0.5 text-xs'>{subtitle}</div>}
      {children}
    </div>
  )

  if (!layered) return <div className={className}>{body}</div>

  return (
    <div
      className={cn(
        'before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 relative px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border',
        className
      )}>
      {body}
    </div>
  )
}

/**
 * Small colored-dot legend row used under multi-series charts. `colorVar` is
 * a chart slot name (`report-c1` … `report-c4`); render inside an element
 * carrying `CHART_VARS_CLASS` (MockCard does this automatically).
 */
export function MockLegend({
  items,
  className,
}: {
  items: { label: string; colorVar: string }[]
  className?: string
}) {
  return (
    <div className={cn('mt-2 flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {items.map((item) => (
        <div key={item.label} className='flex items-center gap-1.5'>
          <span
            className='size-1.5 rounded-full'
            style={{ backgroundColor: `var(--${item.colorVar})` }}
          />
          <span className='text-muted-foreground text-xs'>{item.label}</span>
        </div>
      ))}
    </div>
  )
}
