// apps/web/src/app/(protected)/app/settings/general/_components/edit-user-profile.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { AlertCircle, Edit, Laptop, Smartphone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { UAParser } from 'ua-parser-js'
import { z } from 'zod'
import { client } from '~/auth/auth-client'
import { UserRegistrationInfo } from '~/components/auth/user-registration-info'
import { AvatarUpload } from '~/components/file-upload/ui/avatar-upload'
import { useUser } from '~/hooks/use-user'
import { ChangePassword } from './change-password'
import { EditEmailDialog } from './edit-email-dialog'
import { ListPasskeys } from './list-passkeys'
import { TwoFactorDialog } from './two-factor-dialog'
import { UserPreferencesSection } from './user-preferences-section'

const profileFormSchema = z.object({
  username: z
    .string()
    .min(2, { error: 'Username must be at least 2 characters.' })
    .max(30, { error: 'Username must not be longer than 30 characters.' }),
  // email: z.email({ message: 'Please enter a valid email address.' }),
})

type ProfileFormValues = z.infer<typeof profileFormSchema>

// This can come from your database or API.
const defaultValues: Partial<ProfileFormValues> = {
  username: '',
  // email: '',
}

export function EditUserProfileForm(): JSX.Element {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | undefined>()
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)

  const { user } = useUser()

  const form = useForm<ProfileFormValues>({
    resolver: standardSchemaResolver(profileFormSchema),
    defaultValues,
    mode: 'onChange',
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable
  useEffect(() => {
    if (user) {
      form.reset({ username: user.name || '' })
      setCurrentAvatarUrl(user.image || undefined)
    }
  }, [user])

  async function onSubmit(data: ProfileFormValues) {
    setIsSubmitting(true)

    try {
      // Handle name update
      if (data.username !== user?.name) {
        // TODO: Implement name update API call when available
        toastSuccess({
          title: 'Profile updated',
          description: 'Your profile information has been updated',
        })
      }
    } catch (error) {
      toastError({
        title: 'Update failed',
        description: 'Failed to update profile information',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const { data: session } = client.useSession()

  /**
   * Handle avatar upload completion
   */
  const handleAvatarUpload = (assetId: string, url: string) => {
    setCurrentAvatarUrl(url)
    // TODO: Optionally trigger user data refresh or update user context
  }

  /**
   * Handle sign out - uses the same implementation as nav-user.tsx
   */
  const handleSignOut = () => {
    client.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/') // redirect to login page
        },
      },
    })
  }

  const canEditEmail = (user?.providers?.length ?? 0) === 0
  return (
    <div className='max-w-xl'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
          <div className='space-y-2'>
            <h2 className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
              Photo
            </h2>
            <AvatarUpload
              currentAvatarUrl={currentAvatarUrl}
              onUploadComplete={handleAvatarUpload}
              size='sm'
            />
          </div>

          <FormField
            control={form.control}
            name='username'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormDescription>
                  This is your public display name. It can be your real name or a pseudonym.
                </FormDescription>

                <FormControl>
                  <Input placeholder='Your name' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className='space-y-2'>
            <FormLabel>Email</FormLabel>
            <FormDescription>
              {canEditEmail
                ? 'The email associated with your account'
                : 'Email is managed by your OAuth provider'}
            </FormDescription>
            <div className='relative'>
              <Input
                value={user?.email || ''}
                readOnly
                className='bg-muted flex-1'
                placeholder='Your email address'
              />
              {canEditEmail && (
                <Button
                  type='button'
                  variant='outline'
                  size='xs'
                  onClick={() => setEmailDialogOpen(true)}
                  className='absolute right-1 top-1/2 -translate-y-1/2'>
                  <Edit />
                  Edit
                </Button>
              )}
            </div>
            {/* Show pending verification status */}
            {user && !user.emailVerified && user.email && canEditEmail && (
              <div className='flex items-center gap-2 mt-2 text-sm text-amber-600 dark:text-amber-500'>
                <AlertCircle className='size-4' />
                <span>Pending verification - check your email</span>
              </div>
            )}
          </div>
          {/* User Preferences */}
          <UserPreferencesSection />

          <UserRegistrationInfo />

          <div className='space-y-2'>
            <h2 className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
              Change Password
            </h2>
            <p className='text-[0.8rem] text-muted-foreground'>
              Change or add a password to your account. This can be used to sign in to your account.
            </p>
            <ChangePassword />
          </div>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <h2 className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                Passkeys
              </h2>
              <p className='text-[0.8rem] text-muted-foreground'>Passwordless login.</p>
              <ListPasskeys />
            </div>

            <div className='space-y-2'>
              <h2 className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                Two Factor
              </h2>
              {user?.hasPassword ? (
                <>
                  <p className='text-[0.8rem] text-muted-foreground'>
                    Adds an extra layer of security.
                  </p>

                  <TwoFactorDialog />
                </>
              ) : (
                <div className='space-y-2'>
                  <p className='text-[0.8rem] text-muted-foreground'>
                    Two-factor authentication requires a password to be set up first.
                  </p>
                </div>
              )}
            </div>
          </div>

          {session && (
            <div>
              <div className='flex items-center gap-2 text-sm  text-black font-medium dark:text-white'>
                {new UAParser(session.userAgent || '').getDevice().type === 'mobile' ? (
                  <Smartphone />
                ) : (
                  <Laptop />
                )}
                {new UAParser(session.userAgent || '').getOS().name},{' '}
                {new UAParser(session.userAgent || '').getBrowser().name}
                <button
                  className='text-red-500 opacity-80 cursor-pointer text-xs underline'
                  onClick={handleSignOut}>
                  Sign Out
                </button>
              </div>
            </div>
          )}

          <Button type='submit' variant='outline' loading={isSubmitting} loadingText='Updating...'>
            Update profile
          </Button>
        </form>
      </Form>

      {/* Email Change Dialog */}
      <EditEmailDialog
        currentEmail={user?.email || ''}
        isOpen={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        onSuccess={() => {
          // Optionally refresh user data or router
          router.refresh()
        }}
      />
    </div>
  )
}
