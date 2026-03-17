// src/app/(auth)/signup/page.tsx

// import { Button } from '@auxx/ui/components/button'
// import Link from 'next/link'
import { Logo } from '~/components/global/login/logo'
import { SignUpForm } from '../_components/signup-form'

export default function SignUpPage() {
  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10'>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />
        {/* <h2 className="text-center text-xl font-semibold">Create your account</h2> */}
        <SignUpForm />
      </div>
    </div>
  )
}
