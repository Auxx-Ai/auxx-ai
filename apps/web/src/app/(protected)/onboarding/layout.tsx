// apps/web/src/app/(protected)/onboarding/layout.tsx

import { BorderBeam } from '@auxx/ui/components/border-beam'
import { Card } from '@auxx/ui/components/card'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import type React from 'react'
import { ColorfulBg } from '~/components/global/login/colorful-bg'
import { Logo } from '~/components/global/login/logo'
import { LayoutFooter } from '~/components/layouts/layout-footer'
import { OnboardingProgress } from './_components/onboarding-progress'
import { OnboardingProvider } from './_components/onboarding-provider'

type Props = { children: React.ReactNode }

export default function OnboardingLayout({ children }: Props) {
  return (
    <ColorfulBg>
      <TooltipProvider>
        <OnboardingProvider>
          <div className='flex min-h-screen flex-col relative z-30 bg-white/15'>
            <div className='h-full flex flex-1 flex-col items-center justify-start gap-8 py-8 overflow-hidden'>
              <Logo />
              <div className='flex flex-col items-center justify-center w-full max-w-4xl px-4'>
                <OnboardingProgress />
                <div className='flex flex-col items-center justify-center overflow-hidden py-5 w-full'>
                  <Card
                    variant='translucent'
                    className='w-full max-w-3xl border-transparent px-0 py-0'>
                    <BorderBeam duration={8} size={100} borderWidth={2} />
                    {children}
                  </Card>
                </div>
              </div>
            </div>
            <LayoutFooter showBackToDashboard={false} />
          </div>
        </OnboardingProvider>
      </TooltipProvider>
    </ColorfulBg>
  )
}
