// apps/web/src/components/auth/user-registration-info.tsx
'use client'

import type { User } from 'better-auth/types'
import { Loader2, Lock, Phone } from 'lucide-react'
import { useMemo } from 'react'
import { client } from '~/auth/auth-client'
import { GithubIcon, GoogleIcon } from '~/constants/icons'

/**
 * Component to display how the user registered (OAuth providers and/or email/password)
 */
export function UserRegistrationInfo(): JSX.Element | null {
  const { data: session, isPending } = client.useSession()

  /**
   * Memoized unique providers list to prevent duplicates and unnecessary re-renders
   */
  const uniqueProviders = useMemo(() => {
    if (isPending || !session?.user) return ['loading']

    const { providers = [], hasPassword, phoneNumberVerified } = session.user
    const allProviders = [...providers]

    // Add password authentication if available
    if (hasPassword && !allProviders.includes('credentials')) {
      allProviders.push('credentials')
    }

    // Add phone authentication if verified
    if (phoneNumberVerified && !allProviders.includes('phone')) {
      allProviders.push('phone')
    }

    return [...new Set(allProviders)]
  }, [session?.user, isPending])

  // Don't render anything if there's no session and not loading
  if (!isPending && !session?.user) {
    return null
  }

  const { registrationMethod, hasPassword } = session?.user || {}

  /**
   * Get display name for OAuth provider
   */
  const getProviderDisplayName = (provider: string) => {
    const providerMap: Record<string, string> = {
      google: 'Google',
      github: 'GitHub',
      credentials: 'Email & Password',
      phone: 'Phone & SMS',
      loading: 'Loading...',
    }
    return providerMap[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
  }

  /**
   * Get provider icon/emoji
   */
  const getProviderIcon = (provider: string) => {
    const iconMap: Record<string, JSX.Element> = {
      google: <GoogleIcon className='size-3' />,
      github: <GithubIcon className='size-3' />,
      credentials: <Lock className='size-3' />,
      phone: <Phone className='size-3' />,
      loading: <Loader2 className='size-3 animate-spin' />,
    }
    return iconMap[provider]
  }
  return (
    <div className='space-y-2'>
      <h2 className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
        Account Provider
      </h2>
      {/* Optional description based on registration method */}
      <p className='text-[0.8rem] text-muted-foreground'>
        {isPending && 'Loading your account providers...'}
        {!isPending &&
          registrationMethod === 'mixed' &&
          'You can sign in using any of your connected authentication methods.'}
        {!isPending &&
          registrationMethod === 'oauth' &&
          uniqueProviders.length > 0 &&
          'You can sign in using your connected OAuth provider(s).'}
        {!isPending &&
          registrationMethod === 'email' &&
          'You can sign in using your email and password.'}
        {!isPending &&
          registrationMethod === 'phone' &&
          'You can sign in using your phone number and SMS verification.'}
        {!isPending &&
          (!registrationMethod ||
            uniqueProviders.length === 0 ||
            uniqueProviders.includes('loading')) &&
          'Registration method could not be determined.'}
      </p>

      <div className='flex flex-wrap gap-2'>
        {/* Show OAuth providers */}
        {uniqueProviders.map((provider: string) => (
          <div
            className='flex px-2 h-7 text-sm border border-input rounded-md items-center gap-1 bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80'
            key={provider}>
            {getProviderIcon(provider)}
            {getProviderDisplayName(provider)}
          </div>
        ))}
      </div>
    </div>
  )
}
