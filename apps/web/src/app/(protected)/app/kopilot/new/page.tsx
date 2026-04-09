// apps/web/src/app/(protected)/app/kopilot/new/page.tsx

'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useKopilotStore } from '~/components/kopilot/stores/kopilot-store'
import { KopilotChat } from '~/components/kopilot/ui/kopilot-chat'
import { KopilotSessionPicker } from '~/components/kopilot/ui/kopilot-session-picker'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

export default function KopilotNewPage() {
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.kopilot)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Chats' href='/app/kopilot/new' first />
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
  const router = useRouter()
  const startNewSession = useKopilotStore((s) => s.startNewSession)

  // Clear any existing session state when navigating to /new
  useEffect(() => {
    startNewSession()
  }, [startNewSession])

  const handleSessionChange = useCallback(
    (sessionId: string | null) => {
      if (sessionId) {
        router.push(`/app/kopilot/${sessionId}`)
      } else {
        router.push('/app/kopilot/new')
      }
    },
    [router]
  )

  const handleNewSession = useCallback(() => {
    startNewSession()
    router.push('/app/kopilot/new')
  }, [startNewSession, router])

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            <KopilotSessionPicker
              variant='outline'
              onSessionChange={handleSessionChange}
              onNewSession={handleNewSession}
            />
            <Button variant='outline' size='sm' onClick={handleNewSession}>
              <Plus />
              New chat
            </Button>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Chats' href='/app/kopilot/new' first />
          <MainPageBreadcrumbItem title='New' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <KopilotChat
          page='kopilot'
          context={undefined}
          onSessionChange={handleSessionChange}
          contentClassName='mx-auto w-full max-w-3xl'
        />
      </MainPageContent>
    </MainPage>
  )
}
