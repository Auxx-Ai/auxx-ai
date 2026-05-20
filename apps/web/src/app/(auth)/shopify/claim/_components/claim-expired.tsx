// apps/web/src/app/(auth)/shopify/claim/_components/claim-expired.tsx

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { AlertTriangle } from 'lucide-react'

export function ClaimExpired() {
  return (
    <div className='flex min-h-[calc(100vh-8rem)] w-screen items-center justify-center p-4'>
      <div className='flex w-full max-w-md flex-col items-center space-y-5 px-6'>
        <Card variant='translucent' className='w-full shadow-md shadow-black/20 border-transparent'>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted'>
              <AlertTriangle className='size-8 text-info' />
            </div>
            <CardTitle className='text-white'>Install link expired</CardTitle>
            <CardDescription>
              This Shopify install link has expired. Reinstall Auxx from the Shopify App Store to
              continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant='translucent' className='w-full'>
              <a href='https://apps.shopify.com/auxx-ai' target='_blank' rel='noopener noreferrer'>
                Open Shopify App Store
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
