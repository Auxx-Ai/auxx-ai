// apps/extension/src/iframe/components/header.tsx

import { Button } from '@auxx/ui/components/button'
import { ChevronLeft, X } from 'lucide-react'
import { useRouteStack } from '../hooks/use-route-stack'
import { titleFor } from '../routes/types'
import type { DehydratedState, SessionResponse } from '../trpc'
import { HeaderActions } from './header-actions'
import { UserOrgMenu } from './user-org-menu'

type Props = {
  session: SessionResponse
  onSessionChange: (next: SessionResponse) => void
  onRefreshSession: () => Promise<SessionResponse>
  onClose: () => void
}

/**
 * Root variant: user-org dropdown on the left, close button on the right.
 * Detail variant: back button, route title, right-side action slot, close.
 *
 * Sticky top-0 — @auxx/ui tokens handle the surface colour + border.
 */
export function Header({ session, onSessionChange, onRefreshSession, onClose }: Props) {
  const { top, pop, depth, reset } = useRouteStack()

  const isRoot = depth === 1 && top.kind === 'root'

  return (
    <header className='sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2'>
      {isRoot ? (
        <SignedInLeftSlot
          session={session}
          onSessionChange={onSessionChange}
          onRefreshSession={onRefreshSession}
          onSignedOut={reset}
        />
      ) : (
        <>
          <Button variant='ghost' size='icon' onClick={pop} aria-label='Back' className='size-8'>
            <ChevronLeft className='size-4' />
          </Button>
          <h1 className='min-w-0 truncate text-sm font-medium'>{titleFor(top)}</h1>
        </>
      )}

      <div className='ml-auto flex items-center gap-1'>
        {!isRoot && <HeaderActions route={top} />}
        <Button
          variant='ghost'
          size='icon'
          onClick={onClose}
          aria-label='Close panel'
          className='size-8'>
          <X className='size-4' />
        </Button>
      </div>
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
