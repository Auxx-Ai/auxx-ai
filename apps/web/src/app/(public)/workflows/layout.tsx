// apps/web/src/app/(public)/workflows/layout.tsx

import { DehydrationService } from '@auxx/lib/dehydration'
import Script from 'next/script'
import type { ReactNode } from 'react'
import { DehydratedStateProvider } from '~/providers/dehydrated-state-provider'
import { PublicWorkflowClientLayout } from './layout-client'

/**
 * Layout for public workflow pages.
 * Server component that injects dehydrated environment state
 * so client hooks like useEnv() work in public routes.
 */
export default async function PublicWorkflowLayout({ children }: { children: ReactNode }) {
  const dehydrationService = new DehydrationService()
  const dehydratedState = await dehydrationService.getPublicState()

  return (
    <>
      <Script
        id='dehydrated-state'
        strategy='beforeInteractive'
        dangerouslySetInnerHTML={{
          __html: `window.AUXX_DEHYDRATED_STATE = ${JSON.stringify(dehydratedState).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};`,
        }}
      />
      <DehydratedStateProvider initialState={dehydratedState}>
        <PublicWorkflowClientLayout>{children}</PublicWorkflowClientLayout>
      </DehydratedStateProvider>
    </>
  )
}
