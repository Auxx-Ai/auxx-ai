// src/app/(auth)/reset-password/page.tsx

import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { AlertTriangle } from 'lucide-react' // Icon for error display
import Image from 'next/image'
import Link from 'next/link'
import React, { Suspense } from 'react'
import { Logo } from '~/components/global/login/logo'
import { ResetPasswordForm } from '../_components/reset-password-form'

interface ResetPasswordPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}
interface ResetPasswordContentProps {
  searchParams?: { [key: string]: string | string[] | undefined }
}

// Component to handle reading params and rendering handler or error
function ResetPasswordContent({ searchParams }: ResetPasswordContentProps) {
  const token = searchParams?.token

  if (typeof token !== 'string' || !token) {
    // Handle invalid or missing token
    return (
      <Card className='w-full max-w-md border-destructive bg-white/10'>
        <CardHeader className='items-center text-center'>
          <AlertTriangle className='mb-2 size-8 text-destructive' />
          <CardTitle className='text-destructive'>Invalid Link</CardTitle>
          <CardDescription>
            The password reset link is missing, invalid, or has expired. Please request a new one.
          </CardDescription>
        </CardHeader>
        <CardFooter className='flex justify-center'>
          <Button asChild>
            <Link href='/forgot-password'>Request Reset Link</Link>
          </Button>
          <Button variant='link' asChild className='ml-4'>
            <Link href='/login'>Back to Login</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  // Render the form component, passing the token
  return <ResetPasswordForm token={token} />
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const q = await searchParams

  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10 shadow-[inset_10px_-50px_94px_0_rgb(199,199,199,0.2)] backdrop-blur-sm'>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />
        <Suspense
          fallback={
            <Card className='w-full max-w-md'>
              <CardContent className='p-6 text-center'>Loading...</CardContent>
            </Card>
          }>
          <ResetPasswordContent searchParams={q} />
        </Suspense>
      </div>
    </div>
  )
}
