// apps/web/src/app/(auth)/deactivated/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { ShieldOff } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { client } from '~/auth/auth-client'
import { Logo } from '~/components/global/login/logo'

export default function DeactivatedPage() {
  useEffect(() => {
    client.signOut({ fetchOptions: { onSuccess: () => {} } })
  }, [])

  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10 shadow-[inset_10px_-50px_94px_0_rgb(199,199,199,0.2)] backdrop-blur-sm'>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />
        <Card className='w-full max-w-md shadow-md shadow-black/20 border-transparent'>
          <CardHeader className='items-center text-center'>
            <ShieldOff className='mb-2 size-8 text-destructive' />
            <CardTitle>Account Deactivated</CardTitle>
            <CardDescription>
              Your account has been deactivated by an administrator. If you believe this is a
              mistake, please contact support.
            </CardDescription>
          </CardHeader>
          <CardFooter className='flex justify-center'>
            <Button variant='link' asChild>
              <Link href='/login'>Back to Login</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
