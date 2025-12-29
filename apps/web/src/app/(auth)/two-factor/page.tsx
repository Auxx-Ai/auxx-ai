// src/app/(auth)/signup/page.tsx
import Image from 'next/image'
import Link from 'next/link'
import React from 'react'
import { Button } from '@auxx/ui/components/button'
import TwoFactorForm from '../_components/two-factor-form'
import { Logo } from '~/components/global/login/logo'

export default function TwoFactorPage() {
  return (
    <div className="flex min-h-screen w-screen items-center justify-center p-4 bg-white/10">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <Logo />
        {/* <h2 className="text-center text-xl font-semibold">Create your account</h2> */}
        <TwoFactorForm />
        <p className="text-center text-sm text-muted-foreground">
          Go back to{' '}
          <Button variant="link" className="h-auto p-0" asChild>
            <Link href="/login">Log in</Link>
          </Button>
        </p>
      </div>
    </div>
  )
}
