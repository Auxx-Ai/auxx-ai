// apps/web/src/auth/auth-client.ts
import {
  // organizationClient,
  passkeyClient,
  phoneNumberClient,
  twoFactorClient,
  // adminClient,
  // multiSessionClient,
  // oneTapClient,
  // oidcClient,
  // genericOAuthClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { getEnv } from '~/providers/dehydrated-state-provider'

/** Get base URL from dehydrated environment or env fallback (SSR) */
function getBaseUrl(): string {
  return getEnv()?.appUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
}

export const client = createAuthClient({
  baseURL: getBaseUrl(),
  plugins: [
    passkeyClient(),
    phoneNumberClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = '/two-factor'
      },
    }),
  ],
})

export const { signIn, signOut, useSession, updateUser, signUp, verifyEmail, changeEmail } = client
