// apps/web/src/components/kopilot/ui/sparkle-icon.tsx

import { cn } from '@auxx/ui/lib/utils'
import { Sparkles } from 'lucide-react'

export function SparkleIcon({ className }: { className?: string }) {
  return (
    <div className={cn('animate-hue-rotate relative size-fit', className)}>
      <div className='bg-conic/decreasing relative flex size-4.5 items-center justify-center rounded-full from-violet-500 via-lime-300 to-violet-400 blur-md' />
      <div className='absolute inset-0 flex items-center justify-center'>
        <Sparkles className='size-3.5  *:nth-2:text-purple-400 *:nth-3:text-purple-400' />
      </div>
    </div>
  )
}
