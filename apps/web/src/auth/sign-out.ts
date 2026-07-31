// apps/web/src/auth/sign-out.ts

'use client'

import { clearSessionCaches } from '~/lib/clear-session-caches'
import { client } from './auth-client'

type SignOutOptions = Parameters<typeof client.signOut>[0]
type SignOutFetchOptions = NonNullable<NonNullable<SignOutOptions>['fetchOptions']>
type SignOutSuccessContext = Parameters<NonNullable<SignOutFetchOptions['onSuccess']>>[0]

/**
 * Sign out and clear all session-scoped client caches.
 *
 * Prefer this over calling `client.signOut()` directly — nothing else drops the
 * singleton stores on logout. Caches are cleared once the server has destroyed the
 * session but before the caller's own `onSuccess` runs, so no in-flight query can
 * repopulate them and the redirect happens against already-empty stores.
 */
export function signOutAndClear(options?: SignOutOptions) {
  return client.signOut({
    ...options,
    fetchOptions: {
      ...options?.fetchOptions,
      onSuccess: (context: SignOutSuccessContext) => {
        clearSessionCaches()
        options?.fetchOptions?.onSuccess?.(context)
      },
    },
  })
}
