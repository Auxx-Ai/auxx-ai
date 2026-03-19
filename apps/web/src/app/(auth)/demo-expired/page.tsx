// apps/web/src/app/(auth)/demo-expired/page.tsx

import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'
import { Logo } from '~/components/global/login/logo'

export default function DemoExpiredPage() {
  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10'>
      <div className='flex w-full max-w-sm flex-col items-center gap-6 text-center'>
        <Logo />

        <div className='space-y-2'>
          <h1 className='text-2xl font-semibold tracking-tight'>Your demo has ended</h1>
          <p className='text-sm text-muted-foreground'>
            Thanks for exploring Auxx.ai! Ready to set up your own workspace?
          </p>
        </div>

        <ul className='space-y-1 text-sm text-muted-foreground'>
          <li>&#10003; Free plan available</li>
          <li>&#10003; No credit card required</li>
          <li>&#10003; Connect your real email &amp; Shopify</li>
        </ul>

        <div className='flex flex-col gap-3 w-full'>
          <Button asChild size='lg' className='w-full'>
            <Link href='/signup?from=demo'>Sign Up Free</Link>
          </Button>

          <form action='/api/demo/create-session' method='POST'>
            <Button
              type='submit'
              variant='ghost'
              size='sm'
              className='w-full text-muted-foreground'>
              Start Another Demo
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
