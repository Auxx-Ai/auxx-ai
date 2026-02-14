import { BorderBeam } from '@auxx/ui/components/border-beam'
import type React from 'react'
import { ColorfulBg } from '~/components/global/login/colorful-bg'
import { Logo } from '~/components/global/login/logo'
import { OnboardingProgress } from './_components/onboarding-progress'
import { OnboardingProvider } from './_components/onboarding-provider'

type Props = { children: React.ReactNode }

function layout({ children }: Props) {
  return (
    <>
      <ColorfulBg />
      {/* <AnimatedGridPattern
        numSquares={100}
        maxOpacity={0.3}
        duration={3}
        repeatDelay={1}
        className={cn(
          '[mask-image:radial-gradient(500px_circle_at_center,white,transparent)]',

          'inset-x-0 h-full skew-y-12'
        )}
      /> */}
      <OnboardingProvider>
        <div className='flex min-h-screen flex-col relative z-30'>
          <div className='min-h-screen h-full flex flex-col items-center justify-start gap-8 py-8 overflow-hidden'>
            <Logo />
            <div className='flex flex-col items-center justify-center w-full max-w-4xl px-4'>
              <OnboardingProgress />
              <div className='flex flex-col items-center justify-center overflow-hidden py-5 w-full'>
                <div className='flex flex-row rounded-3xl relative overflow-hidden border border-primary-200 bg-background w-full'>
                  <BorderBeam duration={8} size={100} borderWidth={2} />
                  {children}
                </div>
              </div>
            </div>
          </div>
        </div>
      </OnboardingProvider>
    </>
  )
}

export default layout
