// src/app/(auth)/reset-password/_components/reset-password-form.tsx
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import Link from 'next/link'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { client } from '~/auth/auth-client'

// Schema with password confirmation
const formSchema = z
  .object({
    newPassword: z.string().min(8, { error: 'Password must be at least 8 characters.' }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    error: "Passwords don't match",
    path: ['confirmPassword'], // Set error on confirmPassword field
  })

type ResetPasswordFormValues = z.infer<typeof formSchema>

interface ResetPasswordFormProps {
  token: string
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<ResetPasswordFormValues>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  async function onSubmit(values: ResetPasswordFormValues) {
    if (values.newPassword !== values.confirmPassword) {
      toastError({ title: 'Reset Failed', description: "Passwords don't match" })
      return
    }
    setIsLoading(true)

    const { data, error } = await client.resetPassword({ newPassword: values.newPassword, token })
    // http://localhost:3000/api/auth/reset-password/czxhgyhgZ4muLqt1sqzOuzjS?callbackURL=/reset-password
    if (error) {
      toastError({ description: 'Reset Failed' })
    }
    if (data) {
      toastSuccess({ description: 'Password Reset Successful' })
      // Redirect to login page on success
      // router.push('/login')
    }
    setIsLoading(false)
  }

  return (
    <Card className='w-full max-w-md shadow-md shadow-black/20 border-transparent'>
      <CardHeader className='text-center'>
        <CardTitle>Reset Your Password</CardTitle>
        <CardDescription>Enter and confirm your new password below.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='newPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <Input type='password' placeholder='••••••••' {...field} disabled={isLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='confirmPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm New Password</FormLabel>
                  <FormControl>
                    <Input type='password' placeholder='••••••••' {...field} disabled={isLoading} />
                  </FormControl>
                  <FormMessage /> {/* Will show "Passwords don't match" here */}
                </FormItem>
              )}
            />
            <Button
              type='submit'
              className='w-full'
              loading={isLoading}
              loadingText='Resetting Password...'>
              Reset Password
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className='flex justify-center'>
        <Button variant='link' asChild className='text-sm'>
          <Link href='/login'>Back to Login</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
