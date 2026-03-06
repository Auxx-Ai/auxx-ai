// apps/web/src/app/(auth)/change-password/page.tsx
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
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { toastError } from '@auxx/ui/components/toast'
import { AlertTriangle } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { client } from '~/auth/auth-client'
import { PasswordStrengthIndicator } from '~/components/credentials/password-fields'
import { api } from '~/trpc/react'

function ChangePasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isForced = searchParams.get('forced') === 'true'

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const clearForceFlag = api.auth.clearForcePasswordChange.useMutation()

  const handleSubmit = async () => {
    if (newPassword !== confirmPassword) {
      toastError({ description: 'Passwords do not match' })
      return
    }
    if (newPassword.length < 8) {
      toastError({ description: 'Password must be at least 8 characters' })
      return
    }

    setLoading(true)
    const res = await client.changePassword({
      newPassword,
      currentPassword,
      revokeOtherSessions: false,
    })
    setLoading(false)

    if (res.error) {
      toastError({
        description: res.error.message || "Couldn't change your password. Make sure it's correct.",
      })
      return
    }

    if (isForced) {
      await clearForceFlag.mutateAsync()
    }

    router.push('/')
  }

  return (
    <Card className='w-full max-w-sm'>
      <CardHeader className='items-center text-center'>
        {isForced && <AlertTriangle className='mb-2 size-6 text-amber-500' />}
        <CardTitle>Change Password</CardTitle>
        <CardDescription>
          {isForced
            ? 'An administrator requires you to change your password before continuing.'
            : 'Enter your current password and choose a new one.'}
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='current-password'>Current Password</Label>
          <Input
            type='password'
            id='current-password'
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete='current-password'
            placeholder='Current password'
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='new-password'>New Password</Label>
          <Input
            type='password'
            id='new-password'
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete='new-password'
            placeholder='New password'
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='confirm-password'>Confirm Password</Label>
          <Input
            type='password'
            id='confirm-password'
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete='new-password'
            placeholder='Confirm new password'
          />
        </div>
        <PasswordStrengthIndicator password={newPassword} confirmPassword={confirmPassword} />
      </CardContent>
      <CardFooter>
        <Button
          className='w-full'
          loading={loading}
          loadingText='Changing...'
          onClick={handleSubmit}>
          Change Password
        </Button>
      </CardFooter>
    </Card>
  )
}

export default function ChangePasswordPage() {
  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4'>
      <Suspense fallback={null}>
        <ChangePasswordContent />
      </Suspense>
    </div>
  )
}
