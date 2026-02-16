'use client'
import { AnimatedGridPattern } from '@auxx/ui/components/animated-grid-pattern'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { RocketIcon, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'

export function UpgradeBanner({
  title = 'Upgrade to unlock new features',
  description = 'To use this feature, please upgrade your plan.',
}: {
  title?: string
  description?: string
}) {
  const [isVisible, setIsVisible] = useState(true)
  const selfHosted = useIsSelfHosted()

  if (selfHosted) return null
  if (!isVisible) return null

  return (
    <div className='bg-primary-100 shrink-0 px-4 py-3 text-foreground relative overflow-hidden'>
      <AnimatedGridPattern
        numSquares={100}
        maxOpacity={0.1}
        duration={3}
        repeatDelay={1}
        className={cn(
          '[mask-image:radial-gradient(500px_circle_at_center,white,transparent)]',

          'inset-x-0 h-[500px] skew-y-12 -top-[200px]'
        )}
      />

      <div className='flex gap-2 md:items-center relative z-10'>
        <div className='flex grow gap-3 md:items-center'>
          <div
            className='flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 max-md:mt-0.5'
            aria-hidden='true'>
            <RocketIcon className='opacity-80' size={16} />
          </div>
          <div className='flex grow flex-col justify-between gap-3 md:flex-row md:items-center'>
            <div className='space-y-0.5'>
              <p className='text-sm font-medium'>{title}</p>
              <p className='text-sm text-muted-foreground'>{description}</p>
            </div>
            <div className='flex gap-2 max-md:flex-wrap'>
              <Button size='sm' className='' asChild>
                <Link href='/app/settings/plans' className='flex items-center gap-2'>
                  <Sparkles />
                  Upgrade
                </Link>
              </Button>
            </div>
          </div>
        </div>
        {/* <Button
          variant="ghost"
          className="group -my-1.5 -me-2 size-8 shrink-0 p-0 hover:bg-transparent"
          // onClick={() => setIsVisible(false)}
          aria-label="Close banner">
          <XIcon
            className="opacity-60 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </Button> */}
      </div>
    </div>
  )
}
