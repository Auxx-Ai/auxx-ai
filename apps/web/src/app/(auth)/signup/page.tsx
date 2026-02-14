// src/app/(auth)/signup/page.tsx

import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'
import { Logo } from '~/components/global/login/logo'
// import Logo from '~/../public/logo_color.png' // Adjust path if needed
import { SignUpForm } from '../_components/signup-form'
// import { WEBAPP_URL } from '@auxx/config/client'

export default function SignUpPage() {
  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10'>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />
        {/* <h2 className="text-center text-xl font-semibold">Create your account</h2> */}
        <SignUpForm />
        <p className='text-center text-sm text-muted-foreground'>
          Already have an account?{' '}
          <Button variant='link' className='h-auto p-0' asChild>
            <Link href='/login'>Log in</Link>
          </Button>
        </p>
      </div>
    </div>
  )
}
