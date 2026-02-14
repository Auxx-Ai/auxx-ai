import { cn } from '~/lib/utils'

interface IllustrationProps {
  className?: string
  variant?: 'elevated' | 'outlined' | 'mixed'
}

export const NotificationIllustration = ({
  className,
  variant = 'elevated',
}: IllustrationProps) => {
  return (
    <div aria-hidden className={cn('relative w-full', className)}>
      <div
        className={cn(
          'bg-illustration group relative grid w-full gap-2.5 rounded-2xl p-4 text-xs duration-300 [grid-template-columns:auto_1fr]',
          {
            'shadow-lg shadow-black/10': variant === 'elevated',
            border: variant === 'outlined',
            'ring-border-illustration border border-transparent shadow shadow-black/10 ring-1':
              variant === 'mixed',
          }
        )}>
        <div className='relative h-fit'>
          <div className='absolute -left-1.5 bottom-1.5 rounded-md border-t border-red-700 bg-red-500 px-1 py-px text-[10px] font-medium text-white shadow-md shadow-red-500/35'>
            PDF
          </div>
          <div className='h-10 w-8 rounded-md border bg-gradient-to-b from-gray-100 to-gray-200' />
        </div>
        <div className='mt-0.5'>
          <div className='text-sm font-medium'>react-visualizations.pdf</div>
          <div className='before:bg-primary relative my-1.5 h-1 overflow-hidden rounded-full bg-gray-100 before:absolute before:inset-0 before:w-1/3 before:rounded-r-full before:delay-150 before:duration-300 group-hover:before:w-2/3' />
          <div className='text-muted-foreground text-xs'>29 KB / 120KB</div>
        </div>
      </div>
    </div>
  )
}
