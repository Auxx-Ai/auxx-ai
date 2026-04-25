// apps/extension/src/iframe/components/header.tsx

import { Button } from '@auxx/ui/components/button'
import { ChevronLeft, X } from 'lucide-react'
import { useRouteStack } from '../hooks/use-route-stack'
import type { DehydratedState, SessionResponse } from '../trpc'
import { UserOrgMenu } from './user-org-menu'

type Props = {
  session: SessionResponse
  onSessionChange: (next: SessionResponse) => void
  onRefreshSession: () => Promise<SessionResponse>
  onClose: () => void
}

/**
 * Persistent header. The user/org dropdown is always shown on the left;
 * the back chevron is always shown when there's somewhere to go back to
 * (any route that isn't the matches root). No title — the body owns its
 * own heading + per-record actions (e.g. "Open in Auxx" sits next to the
 * displayName inside the detail view, not in the header).
 *
 * Sticky top-0 — @auxx/ui tokens handle the surface colour + border.
 */
export function Header({ session, onSessionChange, onRefreshSession, onClose }: Props) {
  const { top, pop, depth, reset } = useRouteStack()

  const canGoBack = !(depth === 1 && top.kind === 'root' && top.view === 'matches')

  return (
    <header className='sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between gap-1 border-b bg-background px-2'>
      {/* Back chevron — left edge. Fixed-width slot via `invisible` so the
          centered dropdown's geometry doesn't depend on whether back is
          visible. */}
      <Button
        variant='ghost'
        size='icon'
        onClick={pop}
        aria-label='Back'
        className={canGoBack ? 'size-8' : 'pointer-events-none invisible size-8'}
        tabIndex={canGoBack ? 0 : -1}
        aria-hidden={!canGoBack}>
        <ChevronLeft className='size-4' />
      </Button>
      {/* Absolute-centered dropdown so it sits in the geometric middle of
          the header regardless of the side button widths. The flex
          siblings handle the left/right edges; the absolute element
          ignores their layout but still gets pointer events. */}
      <div className='-translate-x-1/2 pointer-events-none absolute left-1/2 flex items-center'>
        <div className='pointer-events-auto'>
          <SignedInLeftSlot
            session={session}
            onSessionChange={onSessionChange}
            onRefreshSession={onRefreshSession}
            onSignedOut={reset}
          />
        </div>
      </div>
      <Button
        variant='ghost'
        size='icon'
        onClick={onClose}
        aria-label='Close panel'
        className='size-8'>
        <X className='size-4' />
      </Button>
    </header>
  )
}

function SignedInLeftSlot({
  session,
  onSessionChange,
  onRefreshSession,
  onSignedOut,
}: {
  session: SessionResponse
  onSessionChange: (next: SessionResponse) => void
  onRefreshSession: () => Promise<SessionResponse>
  onSignedOut: () => void
}) {
  if (!session.signedIn) {
    return <span className='text-sm font-medium'>Auxx</span>
  }

  return (
    <UserOrgMenu
      state={session.state as DehydratedState}
      onOrgSwitched={async () => {
        await onRefreshSession()
      }}
      onSignedOut={() => {
        onSessionChange({ signedIn: false })
        onSignedOut()
      }}
    />
  )
}
