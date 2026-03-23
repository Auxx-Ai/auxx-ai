// apps/web/src/app/(auth)/demo-expired/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Check } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { client } from '~/auth/auth-client'
import { Logo } from '~/components/global/login/logo'

export default function DemoExpiredPage() {
  // Sign out the expired demo user so they can sign up or log in fresh
  useEffect(() => {
    client.signOut({ fetchOptions: { onSuccess: () => {} } })
  }, [])
  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10'>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />

        <Card variant='translucent' className='border-transparent w-full px-4 py-3'>
          <CardHeader className='text-center'>
            <CardTitle className='text-xl'>Your demo has ended</CardTitle>
            <CardDescription className='sr-only'>
              Thanks for exploring Auxx.ai! Ready to set up your own workspace?
            </CardDescription>
          </CardHeader>

          <CardContent className='flex flex-col gap-4'>
            <div className='flex w-full max-w-sm flex-col items-center gap-6 text-center'>
              <ul className='space-y-2 text-sm text-white/90'>
                <li className='flex items-center gap-2'>
                  <Check className='size-4 text-info' />
                  Free plan available
                </li>
                <li className='flex items-center gap-2'>
                  <Check className='size-4 text-info' />
                  No credit card required
                </li>
                <li className='flex items-center gap-2'>
                  <Check className='size-4 text-info' />
                  Explore all features
                </li>
              </ul>

              <div className='flex flex-col gap-3 w-full'>
                <Button asChild variant='translucent' size='lg' className='w-full'>
                  <Link href='/signup?from=demo'>Sign Up Free</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
