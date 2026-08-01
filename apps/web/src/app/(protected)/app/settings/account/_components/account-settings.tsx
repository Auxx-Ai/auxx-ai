// apps/web/src/app/(protected)/app/settings/account/_components/account-settings.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  AlertCircle,
  CircleUser,
  Edit,
  Fingerprint,
  Laptop,
  Monitor,
  RectangleEllipsis,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useState } from 'react'
import { UAParser } from 'ua-parser-js'
import { client } from '~/auth/auth-client'
import { signOutAndClear } from '~/auth/sign-out'
import { UserRegistrationInfo } from '~/components/auth/user-registration-info'
import { SettingsSection } from '~/components/global/settings-page'
import { Tooltip } from '~/components/global/tooltip'
import { LastLoginDisplay } from '~/components/settings/last-login-display'
import { useDemo } from '~/hooks/use-demo'
import { useUser } from '~/hooks/use-user'
import { useDehydratedUser } from '~/providers/dehydrated-state-provider'
import { ChangePassword } from './change-password'
import { EditEmailDialog } from './edit-email-dialog'
import { ListPasskeys } from './list-passkeys'
import { TwoFactorDialog } from './two-factor-dialog'

/**
 * My Account settings — credential/access management grouped into three sections:
 * Account (email, provider, last login), Security (password, passkeys, 2FA), and
 * the active session.
 */
export function AccountSettings(): React.JSX.Element {
  const router = useRouter()
  const { user } = useUser()
  const { isDemo } = useDemo()
  const dehydratedUser = useDehydratedUser()
  const { data: session } = client.useSession()
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)

  const canEditEmail = (user?.providers?.length ?? 0) === 0

  /**
   * Handle sign out - uses the same implementation as nav-user.tsx
   */
  const handleSignOut = () => {
    signOutAndClear({
      fetchOptions: {
        onSuccess: () => {
          router.push('/') // redirect to login page
        },
      },
    })
  }

  return (
    <div className='max-w-2xl space-y-10'>
      {/* Account */}
      <SettingsSection
        icon={CircleUser}
        title='Account'
        description='Your email, sign-in providers, and last login'>
        {/* Email */}
        <div className='space-y-2'>
          <Label>Email</Label>
          <p className='text-[0.8rem] text-muted-foreground'>
            {canEditEmail
              ? 'The email associated with your account'
              : 'Email is managed by your OAuth provider'}
          </p>
          <div className='relative'>
            <Input
              value={user?.email || ''}
              readOnly
              className='bg-muted flex-1'
              placeholder='Your email address'
            />
            {canEditEmail && !isDemo && (
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
            <div className='flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500'>
              <AlertCircle className='size-4' />
              <span>Pending verification - check your email</span>
            </div>
          )}
        </div>

        {/* Account provider */}
        <UserRegistrationInfo />

        {/* Last login */}
        <LastLoginDisplay
          lastLoginAt={dehydratedUser?.lastLoginAt ?? null}
          timezone={dehydratedUser?.preferredTimezone || 'UTC'}
        />
      </SettingsSection>

      {/* Security */}
      <SettingsSection
        icon={ShieldCheck}
        title='Security'
        description='Passwords, passkeys, and two-factor authentication'>
        {/* Change password */}
        <div className='space-y-2'>
          <h2 className='text-sm font-medium leading-none'>Change Password</h2>
          <p className='text-[0.8rem] text-muted-foreground'>
            Change or add a password to your account. This can be used to sign in to your account.
          </p>
          {isDemo ? (
            <Tooltip content='Sign up for a free account to change your password' side='right'>
              <span className='inline-block'>
                <Button variant='outline' size='sm' disabled>
                  <RectangleEllipsis />
                  Change Password
                </Button>
              </span>
            </Tooltip>
          ) : (
            <ChangePassword />
          )}
        </div>

        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          {/* Passkeys */}
          <div className='space-y-2'>
            <h2 className='text-sm font-medium leading-none'>Passkeys</h2>
            <p className='text-[0.8rem] text-muted-foreground'>Passwordless login.</p>
            {isDemo ? (
              <Tooltip side='right' content='Sign up for a free account to manage passkeys'>
                <span className='inline-block'>
                  <Button variant='outline' size='sm' disabled>
                    <Fingerprint />
                    Passkeys
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <ListPasskeys />
            )}
          </div>

          {/* Two-factor */}
          <div className='space-y-2'>
            <h2 className='text-sm font-medium leading-none'>Two Factor</h2>
            {isDemo ? (
              <>
                <p className='text-[0.8rem] text-muted-foreground'>
                  Adds an extra layer of security.
                </p>
                <Tooltip
                  side='right'
                  content='Sign up for a free account to enable two-factor authentication'>
                  <span className='inline-block'>
                    <Button variant='outline' size='sm' disabled>
                      <ShieldCheck />
                      Enable 2FA
                    </Button>
                  </span>
                </Tooltip>
              </>
            ) : user?.hasPassword ? (
              <>
                <p className='text-[0.8rem] text-muted-foreground'>
                  Adds an extra layer of security.
                </p>
                <TwoFactorDialog />
              </>
            ) : (
              <p className='text-[0.8rem] text-muted-foreground'>
                Two-factor authentication requires a password to be set up first.
              </p>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* Active session */}
      {session && (
        <SettingsSection icon={Monitor} title='Active session'>
          <div className='flex items-center gap-2 text-sm text-black font-medium dark:text-white'>
            {new UAParser(session.userAgent || '').getDevice().type === 'mobile' ? (
              <Smartphone className='size-4' />
            ) : (
              <Laptop className='size-4' />
            )}
            {new UAParser(session.userAgent || '').getOS().name},{' '}
            {new UAParser(session.userAgent || '').getBrowser().name}
            <button
              className='text-red-500 opacity-80 cursor-pointer text-xs underline'
              onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        </SettingsSection>
      )}

      {/* Email Change Dialog */}
      <EditEmailDialog
        currentEmail={user?.email || ''}
        isOpen={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        onSuccess={() => {
          router.refresh()
        }}
      />
    </div>
  )
}
