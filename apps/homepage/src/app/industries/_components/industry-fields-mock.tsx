// apps/homepage/src/app/industries/_components/industry-fields-mock.tsx

import { cn } from '~/lib/utils'

interface IndustryField {
  label: string
  value: string
}

/**
 * Compact work-order record card mock showing a WO number, status pill, and a
 * grid of trade-specific custom fields — mirrors the product's record detail panel.
 */
export function IndustryFieldsMock({
  fields,
  className,
}: {
  fields: IndustryField[]
  className?: string
}) {
  return (
    <div
      className={cn(
        'bg-card ring-foreground/10 rounded-xl border border-transparent shadow-xl shadow-black/5 ring-1',
        'overflow-hidden',
        className
      )}>
      <div className='flex items-center justify-between gap-3 border-b px-4 py-3'>
        <span className='truncate text-sm font-medium'>WO-1051</span>
        <span className='bg-sky-500/15 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400'>
          Scheduled
        </span>
      </div>

      <dl className='grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-xs'>
        {fields.map((field) => (
          <div key={field.label}>
            <dt className='text-muted-foreground text-[10px]'>{field.label}</dt>
            <dd className='text-foreground mt-0.5 font-medium'>{field.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
