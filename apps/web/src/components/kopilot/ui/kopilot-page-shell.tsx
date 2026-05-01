// apps/web/src/components/kopilot/ui/kopilot-page-shell.tsx

'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbDropdown,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useKopilotSessions } from '../hooks/use-kopilot-sessions'
import { useKopilotStore } from '../stores/kopilot-store'
import { KopilotChat } from './kopilot-chat'
import { KopilotSessionList } from './kopilot-session-list'

export interface KopilotPageShellProps {
  /** Session id from the route — null when on `/app/kopilot/new`. */
  sessionId: string | null
}

/**
 * Shared chrome for the Kopilot route pages (`/new` and `/[sessionId]`):
 * feature-flag gate, breadcrumb with session switcher dropdown, "New chat"
 * button, and the chat surface itself. Also owns the URL-sync behavior that
 * flips `/new` to `/[sessionId]` once the server creates the session.
 */
export function KopilotPageShell({ sessionId }: KopilotPageShellProps) {
  const { hasAccess } = useFeatureFlags()
  const router = useRouter()
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const startNewSession = useKopilotStore((s) => s.startNewSession)
  const { sessionOptions } = useKopilotSessions()

  // Reset store state when arriving at /new — clears any persisted session so
  // the user starts from a blank thread.
  useEffect(() => {
    if (sessionId === null) {
      startNewSession()
    }
  }, [sessionId, startNewSession])

  // When the SSE stream creates a session on /new, flip the URL to
  // /[sessionId] without triggering a Next.js navigation. Going through
  // router.replace would unmount KopilotChat and tear down the live SSE
  // connection mid-turn; history.replaceState updates the URL bar in place
  // and is picked up on refresh by the [sessionId] route.
  useEffect(() => {
    if (sessionId === null && activeSessionId) {
      window.history.replaceState(null, '', `/app/kopilot/${activeSessionId}`)
    }
  }, [sessionId, activeSessionId])

  const handleSelectSession = useCallback(
    (nextId: string) => {
      router.push(`/app/kopilot/${nextId}`)
    },
    [router]
  )

  const handleNewSession = useCallback(() => {
    startNewSession()
    router.push('/app/kopilot/new')
  }, [startNewSession, router])

  const breadcrumbLabel = useMemo(() => {
    if (!activeSessionId) return 'New chat'
    return sessionOptions.find((s) => s.value === activeSessionId)?.label ?? 'Chat'
  }, [activeSessionId, sessionOptions])

  if (!hasAccess(FeatureKey.kopilot)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Chats' href='/app/kopilot/new' first last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Kopilot Not Available'
            description='Upgrade your plan to use Kopilot.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <MainPage>
      <MainPageHeader
        action={
          <Button variant='outline' size='sm' onClick={handleNewSession}>
            <Plus />
            New chat
          </Button>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Chats' href='/app/kopilot/new' first />
          <MainPageBreadcrumbDropdown
            label={<span className='max-w-[24ch] truncate'>{breadcrumbLabel}</span>}
            last
            popover
            contentClassName='w-64'>
            <KopilotSessionList
              onSelectSession={handleSelectSession}
              onActiveSessionDeleted={handleNewSession}
            />
          </MainPageBreadcrumbDropdown>
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <KopilotChat
          page='kopilot'
          context={undefined}
          initialSessionId={sessionId}
          contentClassName='mx-auto w-full max-w-3xl'
        />
      </MainPageContent>
    </MainPage>
  )
}
