// apps/extension/src/iframe/app.tsx

import Loader from '@auxx/ui/components/loader'
import { useCallback } from 'react'
import { Header } from './components/header'
import { RouteStackContext, useRouteStackValue } from './hooks/use-route-stack'
import { useSession } from './hooks/use-session'
import { CompanyRoute } from './routes/company-route'
import { ContactRoute } from './routes/contact-route'
import { RootRoute } from './routes/root-route'
import type { Route } from './routes/types'
import type { SessionResponse } from './trpc'

/**
 * Iframe shell — stacked nav over a persistent header.
 *
 * Root route: user+org dropdown in the header, capture flow in the body.
 * Detail routes (contact/company): back button + title + contextual actions
 * in the header, read-only field view in the body.
 *
 * The full shell's Tailwind classes land on a `<div>` here — a host-site CSS
 * leak shouldn't reach the iframe, but `bg-background` + `text-foreground` on
 * the body element (see index.html) already paints the surface before React
 * mounts.
 */
export function App() {
  const stackValue = useRouteStackValue()
  const { state, refresh, setSession } = useSession()

  const closePanel = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'invoke', operation: 'hideFrame', args: [] })
  }, [])

  if (state.status === 'loading') {
    return <Loader size='sm' title='Loading' subtitle='' className='h-full' />
  }

  const session = state.session

  return (
    <RouteStackContext.Provider value={stackValue}>
      <div className='flex h-full flex-col bg-background text-foreground'>
        <Header
          session={session}
          onSessionChange={setSession}
          onRefreshSession={refresh}
          onClose={closePanel}
        />
        <main className='flex-1 overflow-y-auto'>
          <RouteView route={stackValue.top} session={session} />
        </main>
      </div>
    </RouteStackContext.Provider>
  )
}

function RouteView({ route, session }: { route: Route; session: SessionResponse }) {
  switch (route.kind) {
    case 'root':
      return <RootRoute session={session} />
    case 'contact':
      // Re-key on recordId so navigating between two contact detail views
      // (without an intermediate root) re-runs the fetch effect.
      return <ContactRoute key={route.recordId} {...route} />
    case 'company':
      return <CompanyRoute key={route.recordId} {...route} />
  }
}
