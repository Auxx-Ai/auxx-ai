// apps/web/src/app/(auth)/layout.tsx

import { getAppVersion } from '@auxx/config/client'
import { DehydrationService } from '@auxx/lib/dehydration'
import Script from 'next/script'
import type React from 'react'
import { ColorfulBg } from '~/components/global/login/colorful-bg'
import { DehydratedStateProvider } from '~/providers/dehydrated-state-provider'
import { PostHogProvider } from '~/providers/posthog-provider'
import ThemePicker from './_components/theme-picker'

type Props = { children: React.ReactNode }

/**
 * Layout for all auth pages (login, signup, forgot-password, etc.).
 * Provides a slimmed-down dehydrated state with environment config only
 * so PostHog can initialize on unauthenticated pages.
 */
export default async function AuthLayout({ children }: Props) {
  const { version } = getAppVersion()
  const dehydrationService = new DehydrationService()
  const dehydratedState = await dehydrationService.getPublicState()

  return (
    <div>
      <Script
        id='dehydrated-state'
        strategy='beforeInteractive'
        dangerouslySetInnerHTML={{
          __html: `window.AUXX_DEHYDRATED_STATE = ${JSON.stringify(dehydratedState).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};`,
        }}
      />
      <div className='absolute top-0 right-0 z-100 pt-2 pr-2'>
        <ThemePicker />
      </div>
      <DehydratedStateProvider initialState={dehydratedState}>
        <PostHogProvider>
          <ColorfulBg>{children}</ColorfulBg>
        </PostHogProvider>
      </DehydratedStateProvider>
      <div className='absolute bottom-2 left-3'>
        <span className='text-muted-foreground text-xs'>v{version}</span>
      </div>
    </div>
  )
}
