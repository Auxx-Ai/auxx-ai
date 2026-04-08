// apps/web/src/components/kopilot/ui/sparkle-icon.tsx

import { Sparkles } from 'lucide-react'

export function SparkleIcon() {
  return (
    <div className='animate-hue-rotate relative size-fit'>
      <div className='bg-conic/decreasing relative flex size-5 items-center justify-center rounded-full from-violet-500 via-lime-300 to-violet-400 blur-md' />
      <div className='absolute inset-0 flex items-center justify-center'>
        <Sparkles className='size-3.5' />
      </div>
    </div>
  )
}
