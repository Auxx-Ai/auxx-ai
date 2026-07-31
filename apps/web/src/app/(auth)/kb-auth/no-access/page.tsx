// apps/web/src/app/(auth)/kb-auth/no-access/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { Lock } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { signOutAndClear } from '~/auth/sign-out'
import { Logo } from '~/components/global/login/logo'

function NoAccessContent() {
  const params = useSearchParams()
  const reason = params.get('reason')

  const { title, description } = (() => {
    if (reason === 'demo') {
      return {
        title: 'Demo accounts cannot access knowledge bases',
        description:
          'Demo accounts are restricted from accessing organization knowledge bases. Sign in with a regular account to continue.',
      }
    }
    if (reason === 'missing') {
      return {
        title: 'Knowledge base not found',
        description: "The knowledge base you're trying to access doesn't exist.",
      }
    }
    // Only ever reached for a confirmed member of the owning organization, so
    // it can safely say the org exists and point at an admin. The default
    // branch below must stay anonymous — it also serves people with no
    // relationship to the org at all.
    if (reason === 'restricted') {
      return {
        title: "You don't have access to this knowledge base",
        description:
          'Your account is a member of this organization, but this knowledge base is restricted. Ask an admin to grant you access.',
      }
    }
    return {
      title: 'You do not have access',
      description:
        "You're signed in, but you're not a member of the organization that owns this knowledge base. Switch accounts or ask an admin to invite you.",
    }
  })()

  return (
    <Card variant='translucent' className='w-full max-w-md border-transparent px-4 py-3'>
      <CardHeader className='items-center text-center'>
        <Lock className='mb-2 size-8 text-muted-foreground' />
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className='flex justify-center'>
        <Button
          variant='outline'
          onClick={() =>
            signOutAndClear({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = '/login'
                },
              },
            })
          }>
          Switch account
        </Button>
      </CardContent>
      <CardFooter className='flex justify-center'>
        <Button variant='link' asChild className='text-white'>
          <Link href='/'>Back to home</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

export default function KbNoAccessPage() {
  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4'>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />
        <Suspense fallback={null}>
          <NoAccessContent />
        </Suspense>
      </div>
    </div>
  )
}
