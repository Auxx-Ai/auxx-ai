// apps/web/src/app/(auth)/consent/page.tsx

import { Card, CardContent } from '@auxx/ui/components/card'
import { Suspense } from 'react'
import { Logo } from '~/components/global/login/logo'
import { ConsentContent } from './_components/consent-content'

/**
 * Props for the ConsentPage
 */
interface ConsentPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

/**
 * Loading fallback for consent content
 */
function ConsentLoadingFallback() {
  return (
    <Card className='shadow-md shadow-black/20 border-transparent w-full'>
      <CardContent className='flex flex-col gap-4 overflow-hidden pt-6'>
        <div className='text-center py-8'>
          <div className='text-lg'>Loading...</div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * OAuth Consent Page (Server Component)
 * Parses URL params and renders the consent form
 */
export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const q = await searchParams

  // Extract and validate URL parameters
  const consentCode = typeof q?.consent_code === 'string' ? q.consent_code : null
  const clientId = typeof q?.client_id === 'string' ? q.client_id : null
  const scope = typeof q?.scope === 'string' ? q.scope : ''
  const scopes = scope ? scope.split(' ') : []

  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10'>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />
        <Suspense fallback={<ConsentLoadingFallback />}>
          <ConsentContent consentCode={consentCode} clientId={clientId} scopes={scopes} />
        </Suspense>
      </div>
    </div>
  )
}
